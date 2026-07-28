from __future__ import annotations

import asyncio
import os
import re
import secrets
import time
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse

from local_runtime.api.openai_compat import (
    format_audio_transcription_response,
    format_error,
    format_models_list,
    format_responses_create,
    format_responses_stream,
)
from local_runtime.cancellation import (
    ActiveRequestRegistry,
    CancellationToken,
    InferenceCancelledError,
    InferenceTimeoutError,
    ModelBusyError,
    RequestIdInUseError,
    validate_client_request_id,
)
from local_runtime.core.config import RuntimeConfig
from local_runtime.core.doctor import run_doctor
from local_runtime.core.errors import ModelNotFoundError
from local_runtime.core.load_manager import ModelLoadManager
from local_runtime.core.loader import LoadedModel, load_models
from local_runtime.core.logging import configure_logging, get_recent_logs, pop_log_context, push_log_context
from local_runtime.core.readiness import ReadinessTracker
from local_runtime.core.registry import ModelRegistry
from local_runtime.core.selector import SelectionStrategy, detect_platform, is_platform_supported
from local_runtime.core.selftest import run_startup_self_test
from local_runtime.core.supervisor import Supervisor
from local_runtime.helpers.multipart_helpers import enforce_max_size, extract_form_fields
from local_runtime.helpers.structured_enforcer import (
    StructuredOutputEnforcer,
    StructuredOutputFailure,
    detect_structured_mode,
    stream_validated_json,
)
from local_runtime.runtime_types import RunContext, RunRequest

LOGGER = configure_logging()
CLIENT_DISCONNECT_POLL_SECONDS = 0.1
DEFAULT_INFERENCE_TIMEOUT_SECONDS = 300.0


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger = LOGGER
    app.state.logger = logger
    readiness = ReadinessTracker()
    app.state.readiness = readiness
    readiness.mark_phase("config", "ok")
    try:
        config = RuntimeConfig.load()
        config.ensure_dirs()
        app.state.config = config
        app.state.active_requests = ActiveRequestRegistry()
        platform_id = detect_platform()
        app.state.platform_id = platform_id
        readiness.platform_id = platform_id
        logger.info("startup.platform", extra={"platform_id": platform_id})

        models = load_models()
        readiness.mark_phase("discover_models", "ok", detail=f"models={len(models)}")
        warmup_enabled = _env_flag("LOCAL_RUNTIME_WARMUP_ON_START", False)
        logger.info("startup.warmup_config", extra={"enabled": warmup_enabled})
        registry = ModelRegistry(models, platform_id, logger, enable_warmup=warmup_enabled)
        app.state.registry = registry

        selection = SelectionStrategy(platform_id)
        app.state.selection = selection
        computed_defaults = selection.compute_defaults(registry.models_by_endpoint)
        allowed_endpoints = set(registry.models_by_endpoint.keys())
        user_defaults = config.default_models or {}
        defaults: dict[str, str] = {
            endpoint: model_id
            for endpoint, model_id in computed_defaults.items()
            if endpoint in allowed_endpoints
        }
        for endpoint, model_id in user_defaults.items():
            if endpoint not in allowed_endpoints:
                logger.warning(
                    "defaults.override.skipped",
                    extra={"endpoint": endpoint, "model_id": model_id, "reason": "unknown_endpoint"},
                )
                continue
            loaded_model = registry.get_loaded(model_id)
            if loaded_model and is_platform_supported(loaded_model.spec, platform_id):
                defaults[endpoint] = model_id
            else:
                logger.warning(
                    "defaults.override.skipped",
                    extra={"endpoint": endpoint, "model_id": model_id, "reason": "platform_not_supported"},
                )
        config.default_models = defaults
        registry.set_defaults(defaults)
        readiness.defaults = defaults
        readiness.mark_phase("select_defaults", "ok", detail=str(defaults))

        app.state.http_client = httpx.AsyncClient(timeout=30)
        app.state.supervisor = Supervisor()
        app.state.started_at = time.time()
        load_manager = ModelLoadManager(registry, lambda rid: _ctx_factory(rid), readiness, logger)
        app.state.load_manager = load_manager

        await registry.run_startup_hooks(lambda rid: _ctx_factory(rid))
        readiness.mark_phase("startup_hooks", "ok")

        preload_all = _env_flag("LOCAL_RUNTIME_PRELOAD_ALL", False)
        preload_defaults = _env_flag("LOCAL_RUNTIME_PRELOAD_DEFAULTS", False)
        if preload_all:
            targets = [model.spec.id for model in registry.list_models()]
        elif preload_defaults:
            targets = list(dict.fromkeys(defaults.values()))
        else:
            targets = []
        if targets:
            job = load_manager.create_job(targets)
            await load_manager.wait_for_job(job.id)
            readiness.loaded_models = sorted(registry.model_instances.keys())
            readiness.mark_phase("preload", "ok", detail=f"job_id={job.id} status={job.status}")
        else:
            readiness.mark_phase("preload", "skipped", detail="models load on demand")

        selftest_enabled = _env_flag("LOCAL_RUNTIME_SELFTEST", False)
        strict_selftest = _env_flag("LOCAL_RUNTIME_SELFTEST_STRICT", False)
        if selftest_enabled:
            try:
                await run_startup_self_test(registry, defaults, _ctx_factory, readiness, strict_selftest)
            except Exception as exc:
                logger.exception("selftest.failed", extra={"error": str(exc)})
                if strict_selftest:
                    readiness.mark_error("self_test_failed")
                    raise
        else:
            readiness.self_test.status = "skipped"
            readiness.self_test.started_at = readiness.self_test.finished_at = time.time()
        readiness.mark_ready()
        yield
    except Exception:
        readiness.mark_error("startup_failure")
        raise
    finally:
        registry: ModelRegistry | None = getattr(app.state, "registry", None)
        if registry:
            await registry.shutdown(lambda rid: _ctx_factory(rid))
        http_client: httpx.AsyncClient | None = getattr(app.state, "http_client", None)
        if http_client:
            await http_client.aclose()


GATEWAY_SERVICE_ID = "therapy-local-runtime"
GATEWAY_PROTOCOL_VERSION = "1"

app = FastAPI(title="Local Runtime Gateway", version="0.3.0", lifespan=lifespan)


def _parse_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


DEFAULT_ALLOWED_ORIGINS = [
    "https://therapy-deliberate-practice.com",
    # Tauri 2 serves packaged frontends from these exact production origins.
    # The bearer capability and loopback Host check remain the authorization
    # boundary; this list only permits the packaged WebView to reach it.
    "http://tauri.localhost",
    "tauri://localhost",
]
LOCAL_ORIGIN_PATTERN = r"http://(localhost|127\.0\.0\.1)(:\d+)?"


def _resolve_cors_settings() -> tuple[list[str], str | None]:
    """
    Allow localhost/127.0.0.1 origins by default while enabling overrides via env.
    LOCAL_RUNTIME_ALLOW_ORIGINS="https://app.example.com,https://studio.example.com"
    """
    raw = os.getenv("LOCAL_RUNTIME_ALLOW_ORIGINS")
    if raw:
        origins = _parse_csv(raw)
        if "*" in origins:
            raise RuntimeError("LOCAL_RUNTIME_ALLOW_ORIGINS must contain exact trusted origins, not '*'")
        return origins, None
    return DEFAULT_ALLOWED_ORIGINS, LOCAL_ORIGIN_PATTERN


cors_origins, cors_regex = _resolve_cors_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or [],
    allow_origin_regex=cors_regex,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    allow_credentials=False,
    allow_private_network=True,
    max_age=600,
)


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _build_context(
    request_id: str,
    endpoint: str | None = None,
    model_id: str | None = None,
    cancellation_token: CancellationToken | None = None,
) -> RunContext:
    config: RuntimeConfig = app.state.config
    return RunContext(
        request_id=request_id,
        logger=app.state.logger,
        data_dir=config.data_dir,
        cache_dir=config.cache_dir,
        platform=app.state.platform_id,
        registry=app.state.registry,
        http_client=app.state.http_client,
        cancellation_token=cancellation_token,
    )


def _resolve_requested_model(endpoint: str, requested: str | None) -> str | None:
    if requested:
        return requested
    registry: ModelRegistry = app.state.registry
    return registry.selected_defaults.get(endpoint)


def _ctx_factory(
    request_id: str,
    endpoint: str | None = None,
    model_id: str | None = None,
    cancellation_token: CancellationToken | None = None,
) -> RunContext:
    return _build_context(
        request_id,
        endpoint=endpoint,
        model_id=model_id,
        cancellation_token=cancellation_token,
    )


def _is_loopback_host(host_header: str | None) -> bool:
    if not host_header:
        return False
    value = host_header.strip().lower()
    hostname = value.rsplit(":", 1)[0] if ":" in value else value
    return hostname in {"127.0.0.1", "localhost"}


def _is_allowed_origin(origin: str | None) -> bool:
    if not origin:
        return True
    if origin in cors_origins:
        return True
    return bool(cors_regex and re.fullmatch(cors_regex, origin))


def _requires_access_token(path: str) -> bool:
    return path.startswith(("/v1/", "/logs", "/doctor", "/load_models", "/health/details", "/runtime/config"))


def _access_denied(status_code: int, message: str) -> JSONResponse:
    headers = {"Cache-Control": "no-store"}
    if status_code == 401:
        headers["WWW-Authenticate"] = "Bearer"
    return JSONResponse({"error": {"message": message}}, status_code=status_code, headers=headers)


@app.get("/", response_class=HTMLResponse)
async def home_page() -> HTMLResponse:
    return HTMLResponse(
        """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Therapy Local Runtime</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center;
        background: #0b1120; color: #e2e8f0; }
      main { max-width: 40rem; margin: 1.5rem; padding: 2rem; border-radius: 1rem;
        border: 1px solid #334155; background: #0f172a; }
      h1 { margin-top: 0; }
      p { line-height: 1.6; color: #cbd5e1; }
      .status { color: #5eead4; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <p class="status">Local gateway is running</p>
      <h1>Therapy Local Runtime</h1>
      <p>Use the desktop application to manage models, diagnostics, and your private pairing key.</p>
      <p>To connect the Therapy website, open Therapy Settings and paste the local URL and pairing key shown in the desktop application.</p>
    </main>
  </body>
</html>"""
    )


@app.middleware("http")
async def request_context_middleware(request: Request, call_next: Callable):
    supplied_request_id = request.headers.get("x-request-id")
    if supplied_request_id:
        try:
            request_id = validate_client_request_id(supplied_request_id)
        except ValueError as exc:
            return format_error(
                str(exc),
                err_type="invalid_request_error",
                code="invalid_request_id",
                status_code=400,
            )
    else:
        request_id = f"req_{uuid.uuid4().hex}"
    request.state.request_id = request_id
    token = push_log_context(request_id=request_id, endpoint=str(request.url.path))
    start = time.perf_counter()
    logger = getattr(app.state, "logger", LOGGER)
    try:
        origin = request.headers.get("origin")
        if not _is_loopback_host(request.headers.get("host")):
            response = _access_denied(403, "The local gateway accepts loopback Host values only.")
        elif not _is_allowed_origin(origin):
            response = _access_denied(403, "This browser origin is not allowed to use the local gateway.")
        elif request.method == "OPTIONS":
            response = await call_next(request)
        elif _requires_access_token(request.url.path):
            authorization = request.headers.get("authorization", "")
            scheme, _, supplied_token = authorization.partition(" ")
            expected_token = getattr(getattr(app.state, "config", None), "access_token", "")
            if (
                scheme.lower() != "bearer"
                or not supplied_token
                or not expected_token
                or not secrets.compare_digest(supplied_token, expected_token)
            ):
                response = _access_denied(401, "A valid local pairing key is required.")
            else:
                response = await call_next(request)
        else:
            response = await call_next(request)
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        logger.info(
            "request.complete",
            extra={
                "request_id": request_id,
                "endpoint": str(request.url.path),
                "status": response.status_code,
                "duration_ms": duration_ms,
            },
        )
        response.headers["x-request-id"] = request_id
        response.headers["Cache-Control"] = "no-store"
        if origin and _is_allowed_origin(origin) and "access-control-allow-origin" not in response.headers:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers.append("Vary", "Origin")
        if (
            origin
            and _is_allowed_origin(origin)
            and request.headers.get("access-control-request-private-network", "").lower() == "true"
        ):
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response
    except Exception:
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        logger.exception(
            "request.error",
            extra={"request_id": request_id, "endpoint": str(request.url.path), "duration_ms": duration_ms},
        )
        raise
    finally:
        pop_log_context(token)


async def _watch_request_disconnect(request: Request, token: CancellationToken) -> None:
    while not token.cancelled:
        if await request.is_disconnected():
            token.cancel()
            return
        await asyncio.sleep(CLIENT_DISCONNECT_POLL_SECONDS)


def _begin_inference(
    request: Request,
    *,
    timeout_seconds: float,
) -> tuple[str, CancellationToken, asyncio.Task[None]]:
    request_id = getattr(request.state, "request_id", f"req_{uuid.uuid4().hex}")
    registry: ActiveRequestRegistry = app.state.active_requests
    token = registry.register(request_id, timeout_seconds=timeout_seconds)
    watcher = asyncio.create_task(_watch_request_disconnect(request, token))
    return request_id, token, watcher


def _inference_timeout_seconds(selected: LoadedModel) -> float:
    limits = getattr(selected.spec, "limits", None)
    configured = getattr(limits, "timeout_sec", None)
    return float(configured or DEFAULT_INFERENCE_TIMEOUT_SECONDS)


async def _finish_inference(
    request_id: str,
    token: CancellationToken,
    watcher: asyncio.Task[None],
) -> None:
    token.cancel()
    watcher.cancel()
    try:
        await watcher
    except asyncio.CancelledError:
        pass
    registry: ActiveRequestRegistry = app.state.active_requests
    registry.finish(request_id)


async def _finalize_inference_stream(
    source: AsyncIterator,
    request_id: str,
    token: CancellationToken,
    watcher: asyncio.Task[None],
) -> AsyncIterator:
    try:
        async for item in source:
            yield item
    except InferenceTimeoutError as exc:
        yield {
            "event": "error",
            "data": {
                "error": {
                    "type": "inference_timeout",
                    "code": "inference_timeout",
                    "message": str(exc),
                    "status": 504,
                },
                "request_id": request_id,
            },
        }
    except InferenceCancelledError as exc:
        yield {
            "event": "error",
            "data": {
                "error": {
                    "type": "inference_cancelled",
                    "code": "inference_cancelled",
                    "message": str(exc),
                    "status": 499,
                },
                "request_id": request_id,
            },
        }
    finally:
        await _finish_inference(request_id, token, watcher)


def _format_inference_error(exc: Exception) -> JSONResponse:
    if isinstance(exc, ModelBusyError):
        return format_error(
            str(exc),
            err_type="model_busy",
            code="model_busy",
            status_code=409,
        )
    if isinstance(exc, InferenceTimeoutError):
        return format_error(
            str(exc),
            err_type="inference_timeout",
            code="inference_timeout",
            status_code=504,
        )
    if isinstance(exc, InferenceCancelledError):
        return format_error(
            str(exc),
            err_type="inference_cancelled",
            code="inference_cancelled",
            status_code=499,
        )
    raise exc


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse(
        {
            "service": GATEWAY_SERVICE_ID,
            "protocol_version": GATEWAY_PROTOCOL_VERSION,
            "status": app.state.readiness.status,
        }
    )


@app.get("/health/details")
async def health_details() -> JSONResponse:
    data = app.state.readiness.as_payload()
    data["service"] = GATEWAY_SERVICE_ID
    data["protocol_version"] = GATEWAY_PROTOCOL_VERSION
    workers = [worker.__dict__ for worker in app.state.supervisor.status()]
    data["workers"] = workers
    return JSONResponse(data)


@app.get("/logs")
async def logs(limit: int = 200) -> JSONResponse:
    safe_limit = 200
    try:
        safe_limit = max(1, min(int(limit), 500))
    except (TypeError, ValueError):
        pass
    payload = {"logs": get_recent_logs(safe_limit)}
    return JSONResponse(payload)


@app.get("/v1/models")
async def list_models() -> JSONResponse:
    registry: ModelRegistry = app.state.registry
    payload = format_models_list(registry.list_models(), int(app.state.started_at))
    return JSONResponse(payload)


@app.post("/runtime/config")
async def update_runtime_config(request: Request) -> JSONResponse:
    registry: ModelRegistry = app.state.registry
    config: RuntimeConfig = app.state.config
    readiness: ReadinessTracker = app.state.readiness
    try:
        payload = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Configuration must be valid JSON") from exc

    raw_defaults = payload.get("default_models")
    if not isinstance(raw_defaults, dict):
        raise HTTPException(status_code=400, detail="default_models must be an object")
    allowed_endpoints = {"responses", "audio.transcriptions"}
    if set(raw_defaults) != allowed_endpoints:
        raise HTTPException(
            status_code=400,
            detail="Choose exactly one responses model and one audio.transcriptions model",
        )
    defaults: dict[str, str] = {}
    for endpoint in sorted(allowed_endpoints):
        model_id = raw_defaults.get(endpoint)
        if not isinstance(model_id, str) or not model_id:
            raise HTTPException(status_code=400, detail=f"Missing model for {endpoint}")
        loaded_model = registry.get_loaded(model_id)
        if (
            not loaded_model
            or loaded_model.spec.api.endpoint != endpoint
            or not is_platform_supported(loaded_model.spec, registry.platform_id)
        ):
            raise HTTPException(
                status_code=400,
                detail=f"Model '{model_id}' is not compatible with {endpoint} on this platform",
            )
        defaults[endpoint] = model_id

    port = payload.get("port", config.port)
    if not isinstance(port, int) or isinstance(port, bool) or not 1024 <= port <= 65535:
        raise HTTPException(status_code=400, detail="port must be an integer from 1024 to 65535")
    prefer_local = payload.get("prefer_local", config.prefer_local)
    if not isinstance(prefer_local, bool):
        raise HTTPException(status_code=400, detail="prefer_local must be a boolean")

    config.port = port
    config.default_models = defaults
    config.prefer_local = prefer_local
    config.save()
    registry.set_defaults(defaults)
    readiness.defaults = defaults
    return JSONResponse(
        {
            "port": config.port,
            "default_models": defaults,
            "prefer_local": config.prefer_local,
        }
    )


@app.post("/load_models")
async def trigger_model_load(request: Request) -> JSONResponse:
    load_manager: ModelLoadManager = app.state.load_manager
    registry: ModelRegistry = app.state.registry
    logger = getattr(app.state, "logger", LOGGER)
    try:
        payload = await request.json()
    except ValueError:
        payload = {}
    requested_models = payload.get("models")
    scope = str(payload.get("scope") or "selected").lower()
    targets: list[str]
    if requested_models:
        if isinstance(requested_models, str):
            targets = [requested_models]
        elif isinstance(requested_models, (list, tuple, set)):
            targets = [str(model_id) for model_id in requested_models if model_id]
        else:
            raise HTTPException(status_code=400, detail="models must be a string or list of strings")
        scope = "custom"
    else:
        if scope == "all":
            targets = [loaded.spec.id for loaded in registry.list_models()]
        elif scope == "selected":
            targets = [
                model_id for model_id in dict.fromkeys(registry.selected_defaults.values()) if model_id
            ]
        else:
            raise HTTPException(status_code=400, detail="scope must be 'selected' or 'all'")
    filtered: list[str] = []
    missing: list[str] = []
    for model_id in dict.fromkeys(targets):
        if not model_id:
            continue
        if registry.get_loaded(model_id):
            filtered.append(model_id)
        else:
            missing.append(model_id)
    if missing:
        logger.warning("load_models.unknown_models", extra={"models": missing, "scope": scope})
    targets = filtered
    if not targets:
        raise HTTPException(status_code=400, detail="No models specified for loading")

    job = load_manager.create_job(targets)
    return JSONResponse({"job_id": job.id, "status": job.to_dict()})


@app.get("/load_models/{job_id}")
async def get_model_load_status(job_id: str) -> JSONResponse:
    load_manager: ModelLoadManager = app.state.load_manager
    job = load_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Load job not found")
    return JSONResponse(job.to_dict())


def _select_model(endpoint: str, requested: str | None) -> LoadedModel:
    registry: ModelRegistry = app.state.registry
    selection: SelectionStrategy = app.state.selection
    requested_id = _resolve_requested_model(endpoint, requested)
    models = registry.models_by_endpoint.get(endpoint, [])
    if not models:
        raise ModelNotFoundError(f"No models available for endpoint {endpoint}")
    return selection.select(models, endpoint, requested=requested_id)


@app.post("/v1/requests/cancel")
async def cancel_inference_request(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except ValueError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    request_id = payload.get("request_id")
    if not isinstance(request_id, str):
        return format_error(
            "request_id is required.",
            err_type="invalid_request_error",
            code="invalid_request_id",
            status_code=400,
        )
    try:
        validate_client_request_id(request_id)
    except ValueError as exc:
        return format_error(
            str(exc),
            err_type="invalid_request_error",
            code="invalid_request_id",
            status_code=400,
        )
    registry: ActiveRequestRegistry = app.state.active_requests
    registry.cancel(request_id)
    return JSONResponse(
        {
            "status": "cancellation_requested",
            "request_id": request_id,
        },
        status_code=202,
    )


@app.post("/v1/responses")
async def responses(request: Request) -> Response:
    payload = await request.json()
    stream = bool(payload.get("stream"))
    request_id = getattr(request.state, "request_id", f"req_{uuid.uuid4().hex}")
    try:
        selected = _select_model("responses", payload.get("model"))
    except ModelNotFoundError as exc:
        return format_error(str(exc), err_type="not_found", status_code=404)
    model_id = selected.spec.id
    try:
        structured_config = detect_structured_mode(payload)
    except ValueError as exc:
        return format_error(str(exc), err_type="invalid_request_error", status_code=400)
    try:
        request_id, cancellation_token, disconnect_watcher = _begin_inference(
            request,
            timeout_seconds=_inference_timeout_seconds(selected),
        )
    except RequestIdInUseError as exc:
        return format_error(
            str(exc),
            err_type="request_id_in_use",
            code="request_id_in_use",
            status_code=409,
        )
    ctx = _ctx_factory(
        request_id,
        endpoint="responses",
        model_id=model_id,
        cancellation_token=cancellation_token,
    )
    start = time.perf_counter()
    if structured_config:
        enforcer = StructuredOutputEnforcer(
            selected=selected, ctx=ctx, config=structured_config, request_id=request_id
        )
        try:
            structured_result = await enforcer.run(payload)
        except (InferenceCancelledError, ModelBusyError) as exc:
            return _format_inference_error(exc)
        except StructuredOutputFailure as exc:
            return format_error(str(exc), err_type="invalid_request_error", status_code=422)
        except RuntimeError as exc:  # jsonschema missing or unexpected enforcement failure
            return format_error(str(exc), status_code=500)
        finally:
            await _finish_inference(request_id, cancellation_token, disconnect_watcher)
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        app.state.logger.info(
            "responses.run",
            extra={
                "request_id": request_id,
                "model_id": model_id,
                "duration_ms": duration_ms,
                "structured": True,
                "attempts": structured_result.attempts,
            },
        )
        if stream:
            return StreamingResponse(
                format_responses_stream(
                    stream_validated_json(model_id, structured_result.canonical_text, request_id=request_id)
                ),
                media_type="text/event-stream",
            )
        payload_out = format_responses_create(
            structured_result.canonical_text, model_id, request_id=request_id
        )
        return JSONResponse(payload_out)
    run_request = RunRequest(endpoint="responses", model=model_id, json=payload, stream=stream)
    stream_owns_cleanup = False
    try:
        result = await selected.module.run(run_request, ctx)
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        app.state.logger.info(
            "responses.run",
            extra={"request_id": request_id, "model_id": model_id, "duration_ms": duration_ms},
        )
        if stream:
            response = StreamingResponse(
                format_responses_stream(
                    _finalize_inference_stream(
                        result,
                        request_id,
                        cancellation_token,
                        disconnect_watcher,
                    )
                ),
                media_type="text/event-stream",
            )
            stream_owns_cleanup = True
            return response
        payload_out = format_responses_create(result, model_id, request_id=request_id)
        return JSONResponse(payload_out)
    except (InferenceCancelledError, ModelBusyError) as exc:
        return _format_inference_error(exc)
    finally:
        if not stream_owns_cleanup:
            await _finish_inference(request_id, cancellation_token, disconnect_watcher)


@app.post("/v1/audio/speech")
async def audio_speech(request: Request) -> JSONResponse:
    request_id = getattr(request.state, "request_id", f"req_{uuid.uuid4().hex}")
    app.state.logger.info(
        "audio.speech.disabled",
        extra={"request_id": request_id},
    )
    return JSONResponse(
        {"message": "Text-to-speech is not enabled in this build of the local runtime."},
        status_code=503,
    )


@app.post("/v1/audio/transcriptions")
async def audio_transcriptions(request: Request) -> Response:
    form = await request.form()
    fields, files = extract_form_fields(form)
    stream = str(fields.get("stream", "false")).lower() == "true"
    response_format = fields.get("response_format", "json")
    request_id = getattr(request.state, "request_id", f"req_{uuid.uuid4().hex}")
    try:
        selected = _select_model("audio.transcriptions", fields.get("model"))
    except ModelNotFoundError as exc:
        return format_error(str(exc), err_type="not_found", status_code=404)
    model_id = selected.spec.id
    if "file" not in files:
        return format_error("Missing file", err_type="invalid_request_error", status_code=400)
    enforce_max_size(files["file"], selected.spec.limits.max_input_mb)
    run_request = RunRequest(
        endpoint="audio.transcriptions",
        model=model_id,
        form=fields,
        files={"file": files["file"].__dict__},
        stream=stream,
    )
    try:
        request_id, cancellation_token, disconnect_watcher = _begin_inference(
            request,
            timeout_seconds=_inference_timeout_seconds(selected),
        )
    except RequestIdInUseError as exc:
        return format_error(
            str(exc),
            err_type="request_id_in_use",
            code="request_id_in_use",
            status_code=409,
        )
    ctx = _ctx_factory(
        request_id,
        endpoint="audio.transcriptions",
        model_id=model_id,
        cancellation_token=cancellation_token,
    )
    start = time.perf_counter()
    stream_owns_cleanup = False
    try:
        result = await selected.module.run(run_request, ctx)
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        app.state.logger.info(
            "audio.transcriptions.run",
            extra={"request_id": request_id, "model_id": model_id, "duration_ms": duration_ms},
        )
        if stream:
            response = format_audio_transcription_response(
                _finalize_inference_stream(
                    result,
                    request_id,
                    cancellation_token,
                    disconnect_watcher,
                ),
                response_format,
                True,
            )
            stream_owns_cleanup = True
            return response
        return format_audio_transcription_response(result, response_format, False)
    except (InferenceCancelledError, ModelBusyError) as exc:
        return _format_inference_error(exc)
    finally:
        if not stream_owns_cleanup:
            await _finish_inference(request_id, cancellation_token, disconnect_watcher)


@app.post("/v1/audio/translations")
async def audio_translations(request: Request) -> Response:
    form = await request.form()
    fields, files = extract_form_fields(form)
    stream = str(fields.get("stream", "false")).lower() == "true"
    response_format = fields.get("response_format", "json")
    request_id = getattr(request.state, "request_id", f"req_{uuid.uuid4().hex}")
    try:
        selected = _select_model("audio.translations", fields.get("model"))
    except ModelNotFoundError as exc:
        return format_error(str(exc), err_type="not_found", status_code=404)
    model_id = selected.spec.id
    if "file" not in files:
        return format_error("Missing file", err_type="invalid_request_error", status_code=400)
    enforce_max_size(files["file"], selected.spec.limits.max_input_mb)
    run_request = RunRequest(
        endpoint="audio.translations",
        model=model_id,
        form=fields,
        files={"file": files["file"].__dict__},
        stream=stream,
    )
    try:
        request_id, cancellation_token, disconnect_watcher = _begin_inference(
            request,
            timeout_seconds=_inference_timeout_seconds(selected),
        )
    except RequestIdInUseError as exc:
        return format_error(
            str(exc),
            err_type="request_id_in_use",
            code="request_id_in_use",
            status_code=409,
        )
    ctx = _ctx_factory(
        request_id,
        endpoint="audio.translations",
        model_id=model_id,
        cancellation_token=cancellation_token,
    )
    start = time.perf_counter()
    stream_owns_cleanup = False
    try:
        result = await selected.module.run(run_request, ctx)
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        app.state.logger.info(
            "audio.translations.run",
            extra={"request_id": request_id, "model_id": model_id, "duration_ms": duration_ms},
        )
        if stream:
            response = format_audio_transcription_response(
                _finalize_inference_stream(
                    result,
                    request_id,
                    cancellation_token,
                    disconnect_watcher,
                ),
                response_format,
                True,
            )
            stream_owns_cleanup = True
            return response
        return format_audio_transcription_response(result, response_format, False)
    except (InferenceCancelledError, ModelBusyError) as exc:
        return _format_inference_error(exc)
    finally:
        if not stream_owns_cleanup:
            await _finish_inference(request_id, cancellation_token, disconnect_watcher)


@app.get("/doctor")
async def doctor() -> JSONResponse:
    return JSONResponse({"checks": [check.__dict__ for check in run_doctor()]})


def main() -> None:
    import argparse

    import uvicorn

    parser = argparse.ArgumentParser(description="Local runtime gateway")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--config", type=str, default=None)
    args = parser.parse_args()

    config_path = Path(args.config) if args.config else None
    if config_path is not None:
        os.environ["LOCAL_RUNTIME_CONFIG"] = str(config_path)
    config = RuntimeConfig.load(config_path)
    if args.port is not None:
        config.port = args.port
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=config.port,
        reload=_env_flag("LOCAL_RUNTIME_RELOAD", False),
    )


if __name__ == "__main__":
    main()
