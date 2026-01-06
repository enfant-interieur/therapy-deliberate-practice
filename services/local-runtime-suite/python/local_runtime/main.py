from __future__ import annotations

import os
import time
import uuid
from pathlib import Path
from typing import Callable

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from local_runtime.api.openai_compat import (
    format_audio_speech_response,
    format_audio_transcription_response,
    format_error,
    format_models_list,
    format_responses_create,
    format_responses_stream,
)
from local_runtime.core.config import RuntimeConfig
from local_runtime.core.doctor import run_doctor
from local_runtime.core.errors import ModelNotFoundError
from local_runtime.core.loader import LoadedModel, load_models
from local_runtime.core.logging import configure_logging, pop_log_context, push_log_context
from local_runtime.core.readiness import ReadinessTracker
from local_runtime.core.registry import ModelRegistry
from local_runtime.core.selector import SelectionStrategy, detect_platform
from local_runtime.core.selftest import run_startup_self_test
from local_runtime.core.supervisor import Supervisor
from local_runtime.helpers.audio_helpers import resolve_content_type
from local_runtime.helpers.multipart_helpers import enforce_max_size, extract_form_fields
from local_runtime.types import RunContext, RunRequest

LOGGER = configure_logging()

app = FastAPI(title="Local Runtime Gateway", version="0.2.0")


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _build_context(request_id: str, endpoint: str | None = None, model_id: str | None = None) -> RunContext:
    config: RuntimeConfig = app.state.config
    return RunContext(
        request_id=request_id,
        logger=app.state.logger,
        data_dir=config.data_dir,
        cache_dir=config.cache_dir,
        platform=app.state.platform_id,
        registry=app.state.registry,
        http_client=app.state.http_client,
        cancellation_token=None,
    )


def _resolve_requested_model(endpoint: str, requested: str | None) -> str | None:
    if requested:
        return requested
    registry: ModelRegistry = app.state.registry
    return registry.selected_defaults.get(endpoint)


def _ctx_factory(request_id: str, endpoint: str | None = None, model_id: str | None = None) -> RunContext:
    return _build_context(request_id, endpoint=endpoint, model_id=model_id)


@app.middleware("http")
async def request_context_middleware(request: Request, call_next: Callable):
    request_id = request.headers.get("x-request-id") or f"req_{uuid.uuid4().hex}"
    request.state.request_id = request_id
    token = push_log_context(request_id=request_id, endpoint=str(request.url.path))
    start = time.perf_counter()
    logger = getattr(app.state, "logger", LOGGER)
    try:
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        logger.info(
            "request.complete",
            extra={"request_id": request_id, "endpoint": str(request.url.path), "status": response.status_code, "duration_ms": duration_ms},
        )
        response.headers["x-request-id"] = request_id
        return response
    except Exception:
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        logger.exception("request.error", extra={"request_id": request_id, "endpoint": str(request.url.path), "duration_ms": duration_ms})
        raise
    finally:
        pop_log_context(token)


@app.on_event("startup")
async def startup() -> None:
    logger = LOGGER
    app.state.logger = logger
    readiness = ReadinessTracker()
    app.state.readiness = readiness
    readiness.mark_phase("config", "ok")
    try:
        config = RuntimeConfig.load()
        config.ensure_dirs()
        app.state.config = config
        platform_id = detect_platform()
        app.state.platform_id = platform_id
        readiness.platform_id = platform_id
        logger.info("startup.platform", extra={"platform_id": platform_id})

        models = load_models()
        readiness.mark_phase("discover_models", "ok", detail=f"models={len(models)}")
        registry = ModelRegistry(models, platform_id, logger)
        app.state.registry = registry

        selection = SelectionStrategy(platform_id)
        app.state.selection = selection
        defaults = config.default_models or selection.compute_defaults(registry.models_by_endpoint)
        if not config.default_models:
            config.default_models = defaults
        registry.set_defaults(defaults)
        readiness.defaults = defaults
        readiness.mark_phase("select_defaults", "ok", detail=str(defaults))

        app.state.http_client = httpx.AsyncClient(timeout=30)
        app.state.supervisor = Supervisor()
        app.state.started_at = time.time()

        await registry.run_startup_hooks(lambda rid: _ctx_factory(rid))
        readiness.mark_phase("startup_hooks", "ok")

        preload_all = _env_flag("LOCAL_RUNTIME_PRELOAD_ALL", False)
        if preload_all:
            targets = [model.spec.id for model in registry.list_models()]
        else:
            targets = list(defaults.values())
        await registry.preload(targets, lambda rid: _ctx_factory(rid))
        readiness.loaded_models = sorted(registry.model_instances.keys())
        readiness.mark_phase("preload", "ok", detail=f"targets={len(targets)}")

        selftest_enabled = _env_flag("LOCAL_RUNTIME_SELFTEST", True)
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
    except Exception:
        readiness.mark_error("startup_failure")
        raise


@app.on_event("shutdown")
async def shutdown() -> None:
    registry: ModelRegistry | None = getattr(app.state, "registry", None)
    if registry:
        await registry.shutdown(lambda rid: _ctx_factory(rid))
    http_client: httpx.AsyncClient | None = getattr(app.state, "http_client", None)
    if http_client:
        await http_client.aclose()


@app.get("/health")
async def health() -> JSONResponse:
    data = app.state.readiness.as_payload()
    workers = [worker.__dict__ for worker in app.state.supervisor.status()]
    data["workers"] = workers
    return JSONResponse(data)


@app.get("/v1/models")
async def list_models() -> JSONResponse:
    registry: ModelRegistry = app.state.registry
    payload = format_models_list(registry.list_models(), int(app.state.started_at))
    return JSONResponse(payload)


def _select_model(endpoint: str, requested: str | None) -> LoadedModel:
    registry: ModelRegistry = app.state.registry
    selection: SelectionStrategy = app.state.selection
    requested_id = _resolve_requested_model(endpoint, requested)
    models = registry.models_by_endpoint.get(endpoint, [])
    if not models:
        raise ModelNotFoundError(f"No models available for endpoint {endpoint}")
    return selection.select(models, endpoint, requested=requested_id)


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
    run_request = RunRequest(endpoint="responses", model=model_id, json=payload, stream=stream)
    ctx = _ctx_factory(request_id, endpoint="responses", model_id=model_id)
    start = time.perf_counter()
    result = await selected.module.run(run_request, ctx)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    app.state.logger.info("responses.run", extra={"request_id": request_id, "model_id": model_id, "duration_ms": duration_ms})
    if stream:
        return StreamingResponse(format_responses_stream(result), media_type="text/event-stream")
    payload = format_responses_create(result, model_id, request_id=request_id)
    return JSONResponse(payload)


@app.post("/v1/audio/speech")
async def audio_speech(request: Request) -> Response:
    payload = await request.json()
    stream = bool(payload.get("stream"))
    request_id = getattr(request.state, "request_id", f"req_{uuid.uuid4().hex}")
    response_format = payload.get("response_format")
    try:
        selected = _select_model("audio.speech", payload.get("model"))
    except ModelNotFoundError as exc:
        return format_error(str(exc), err_type="not_found", status_code=404)
    model_id = selected.spec.id
    run_request = RunRequest(endpoint="audio.speech", model=model_id, json=payload, stream=stream)
    ctx = _ctx_factory(request_id, endpoint="audio.speech", model_id=model_id)
    start = time.perf_counter()
    result = await selected.module.run(run_request, ctx)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    app.state.logger.info("audio.speech.run", extra={"request_id": request_id, "model_id": model_id, "duration_ms": duration_ms})
    content_type = resolve_content_type(response_format)
    return format_audio_speech_response(result, content_type, stream)


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
    ctx = _ctx_factory(request_id, endpoint="audio.transcriptions", model_id=model_id)
    start = time.perf_counter()
    result = await selected.module.run(run_request, ctx)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    app.state.logger.info("audio.transcriptions.run", extra={"request_id": request_id, "model_id": model_id, "duration_ms": duration_ms})
    return format_audio_transcription_response(result, response_format, stream)


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
    ctx = _ctx_factory(request_id, endpoint="audio.translations", model_id=model_id)
    start = time.perf_counter()
    result = await selected.module.run(run_request, ctx)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    app.state.logger.info("audio.translations.run", extra={"request_id": request_id, "model_id": model_id, "duration_ms": duration_ms})
    return format_audio_transcription_response(result, response_format, stream)


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
