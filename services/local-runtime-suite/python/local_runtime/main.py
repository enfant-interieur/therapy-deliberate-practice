from __future__ import annotations

import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from local_runtime.core.config import RuntimeConfig
from local_runtime.core.doctor import run_doctor
from local_runtime.core.errors import ModelNotFoundError
from local_runtime.core.loader import load_models
from local_runtime.core.logging import configure_logging
from local_runtime.core.selector import detect_platform, select_model
from local_runtime.core.sse import format_sse_event
from local_runtime.core.supervisor import Supervisor
from local_runtime.helpers.audio_helpers import resolve_content_type
from local_runtime.helpers.multipart_helpers import enforce_max_size, extract_form_fields
from local_runtime.types import RunContext, RunRequest

configure_logging()
logger = logging.getLogger("local-runtime")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.last_error = None
    app.state.started_at = time.time()

    config = getattr(app.state, "config", None)
    if not isinstance(config, RuntimeConfig):
        raw = os.getenv("LOCAL_RUNTIME_CONFIG", "").strip()
        config_path = Path(raw).expanduser() if raw else None
        config = RuntimeConfig.load(config_path)
        app.state.config = config

    app.state.config.ensure_dirs()
    app.state.platform_id = detect_platform()
    app.state.supervisor = Supervisor()
    app.state.http_client = httpx.AsyncClient(timeout=30)

    try:
        app.state.models = load_models()
    except Exception as exc:
        app.state.models = []
        app.state.last_error = f"Startup failed: {exc!r}"
        logger.exception("Startup failed (models will be empty).")

    try:
        yield
    finally:
        await app.state.http_client.aclose()


app = FastAPI(title="Local Runtime Gateway", version="0.1.0", lifespan=lifespan)


def build_context(request_id: str) -> RunContext:
    config: RuntimeConfig = app.state.config
    return RunContext(
        request_id=request_id,
        logger=logging.getLogger("local-runtime"),
        data_dir=config.data_dir,
        cache_dir=config.cache_dir,
        platform=app.state.platform_id,
        http_client=app.state.http_client,
        cancellation_token=None,
    )


def resolve_requested_model(endpoint: str, model: str | None) -> str | None:
    if model:
        return model
    config: RuntimeConfig = app.state.config
    return config.default_models.get(endpoint)


@app.get("/health")
async def health() -> JSONResponse:
    status = "ready"
    if app.state.last_error:
        status = "error"
    elif time.time() - app.state.started_at < 1:
        status = "starting"
    defaults = app.state.config.default_models
    workers = [worker.__dict__ for worker in app.state.supervisor.status()]
    return JSONResponse({"status": status, "defaults": defaults, "workers": workers, "last_error": app.state.last_error})


@app.get("/v1/models")
async def list_models() -> JSONResponse:
    data = []
    for loaded in app.state.models:
        spec = loaded.spec
        data.append(
            {
                "id": spec.id,
                "object": "model",
                "created": int(app.state.started_at),
                "owned_by": "local-runtime",
                "metadata": {
                    "kind": spec.kind,
                    "api": spec.api.model_dump(),
                    "display": spec.display.model_dump(),
                    "compat": spec.compat.model_dump(),
                    "backend": spec.backend.model_dump(),
                },
            }
        )
    return JSONResponse({"object": "list", "data": data})


@app.post("/v1/responses")
async def responses(request: Request) -> Response:
    payload = await request.json()
    stream = bool(payload.get("stream"))
    request_id = payload.get("id") or f"req_{uuid.uuid4().hex}"
    requested_model = resolve_requested_model("responses", payload.get("model"))
    try:
        selected = select_model(app.state.models, "responses", requested_model, app.state.platform_id)
    except ModelNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    run_request = RunRequest(endpoint="responses", model=selected.spec.id, json=payload, stream=stream)
    result = await selected.module.run(run_request, build_context(request_id))
    if stream:
        async def stream_generator():
            async for event in result:
                yield format_sse_event(event["event"], event["data"])

        return StreamingResponse(stream_generator(), media_type="text/event-stream")

    return JSONResponse(result)


@app.post("/v1/audio/speech")
async def audio_speech(request: Request) -> Response:
    payload = await request.json()
    stream = bool(payload.get("stream"))
    request_id = payload.get("id") or f"req_{uuid.uuid4().hex}"
    requested_model = resolve_requested_model("audio.speech", payload.get("model"))
    try:
        selected = select_model(app.state.models, "audio.speech", requested_model, app.state.platform_id)
    except ModelNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    run_request = RunRequest(endpoint="audio.speech", model=selected.spec.id, json=payload, stream=stream)
    result = await selected.module.run(run_request, build_context(request_id))
    content_type = resolve_content_type(payload.get("response_format"))
    if stream:
        return StreamingResponse(result, media_type=content_type)
    return Response(content=result, media_type=content_type)


@app.post("/v1/audio/transcriptions")
async def audio_transcriptions(request: Request) -> Response:
    form = await request.form()
    fields, files = extract_form_fields(form)
    stream = str(fields.get("stream", "false")).lower() == "true"
    request_id = f"req_{uuid.uuid4().hex}"
    requested_model = resolve_requested_model("audio.transcriptions", fields.get("model"))
    try:
        selected = select_model(app.state.models, "audio.transcriptions", requested_model, app.state.platform_id)
    except ModelNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if "file" not in files:
        raise HTTPException(status_code=400, detail="Missing file")
    enforce_max_size(files["file"], selected.spec.limits.max_input_mb)

    run_request = RunRequest(
        endpoint="audio.transcriptions",
        model=selected.spec.id,
        form=fields,
        files={"file": files["file"].__dict__},
        stream=stream,
    )
    result = await selected.module.run(run_request, build_context(request_id))
    response_format = fields.get("response_format", "json")
    if stream:
        async def stream_generator():
            async for event in result:
                yield format_sse_event(event["event"], event["data"])

        return StreamingResponse(stream_generator(), media_type="text/event-stream")

    if response_format in {"text", "srt", "vtt"}:
        return Response(content=str(result), media_type="text/plain")
    return JSONResponse(result)


@app.post("/v1/audio/translations")
async def audio_translations(request: Request) -> Response:
    form = await request.form()
    fields, files = extract_form_fields(form)
    stream = str(fields.get("stream", "false")).lower() == "true"
    request_id = f"req_{uuid.uuid4().hex}"
    requested_model = resolve_requested_model("audio.translations", fields.get("model"))
    try:
        selected = select_model(app.state.models, "audio.translations", requested_model, app.state.platform_id)
    except ModelNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if "file" not in files:
        raise HTTPException(status_code=400, detail="Missing file")
    enforce_max_size(files["file"], selected.spec.limits.max_input_mb)

    run_request = RunRequest(
        endpoint="audio.translations",
        model=selected.spec.id,
        form=fields,
        files={"file": files["file"].__dict__},
        stream=stream,
    )
    result = await selected.module.run(run_request, build_context(request_id))
    response_format = fields.get("response_format", "json")
    if stream:
        async def stream_generator():
            async for event in result:
                yield format_sse_event(event["event"], event["data"])

        return StreamingResponse(stream_generator(), media_type="text/event-stream")

    if response_format in {"text", "srt", "vtt"}:
        return Response(content=str(result), media_type="text/plain")
    return JSONResponse(result)


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

    config_path = Path(args.config).expanduser() if args.config else None
    if config_path is not None:
        os.environ["LOCAL_RUNTIME_CONFIG"] = str(config_path)

    config = RuntimeConfig.load(config_path)
    app.state.config = config

    if args.port is not None:
        config.port = args.port
    reload_enabled = os.environ.get("LOCAL_RUNTIME_RELOAD", "").lower() in {"1", "true", "yes"}

    if reload_enabled:
        uvicorn.run(
            "local_runtime.main:app",
            host="127.0.0.1",
            port=config.port,
            reload=True,
        )
        return

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=config.port,
        reload=False,
    )


if __name__ == "__main__":
    main()
