from __future__ import annotations

import asyncio
import uuid
from typing import Any, AsyncIterator

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from local_runtime.core.platform import current_platform
from local_runtime.core.selector import select_default
from local_runtime.core.sse import format_sse
from local_runtime.types import RunContext, RunRequest

router = APIRouter()


async def _stream_events(events: AsyncIterator[dict[str, Any]]) -> AsyncIterator[str]:
    async for event in events:
        yield format_sse(event)
    yield "data: [DONE]\n\n"


@router.post("/v1/audio/transcriptions")
async def create_transcription(request: Request) -> Response:
    form = await request.form()
    upload = form.get("file")
    if upload is None:
        return JSONResponse({"error": {"message": "file missing"}}, status_code=400)

    registry = request.app.state.registry
    model = select_default(registry, "audio.transcriptions", form.get("model"))
    content = await upload.read()
    if len(content) > model.spec.limits.max_input_mb * 1024 * 1024:
        return JSONResponse({"error": {"message": "file too large"}}, status_code=413)

    fields = {key: value for key, value in form.items() if key != "file"}
    files = {
        "file": {
            "filename": upload.filename,
            "content_type": upload.content_type,
            "data": content,
        }
    }
    run_req = RunRequest(
        endpoint="audio.transcriptions",
        model=model.spec.id,
        form=fields,
        files=files,
        stream=fields.get("stream") in {True, "true", "1"},
    )
    ctx = RunContext(
        request_id=f"req_{uuid.uuid4().hex[:8]}",
        logger=request.app.state.logger,
        data_dir=request.app.state.config.data_dir,
        cache_dir=request.app.state.config.cache_dir,
        platform=current_platform(),
        http_client=httpx.AsyncClient(),
        cancel_token=asyncio.Event(),
        state={},
    )
    result = await model.module.run(run_req, ctx)
    if run_req.stream:
        return StreamingResponse(_stream_events(result), media_type="text/event-stream")
    response_format = fields.get("response_format", "json")
    if response_format in {"text", "srt", "vtt"}:
        return Response(content=result, media_type="text/plain")
    return JSONResponse(result)
