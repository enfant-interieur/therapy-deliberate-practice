from __future__ import annotations

import asyncio
import uuid
from typing import Any, AsyncIterator

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import Response, StreamingResponse

from local_runtime.core.platform import current_platform
from local_runtime.core.selector import select_default
from local_runtime.core.sse import format_sse
from local_runtime.helpers.audio_helpers import media_type_for
from local_runtime.types import RunContext, RunRequest

router = APIRouter()


async def _stream_audio(generator: AsyncIterator[bytes]) -> AsyncIterator[bytes]:
    async for chunk in generator:
        yield chunk


async def _stream_sse(generator: AsyncIterator[dict[str, Any]]) -> AsyncIterator[str]:
    async for event in generator:
        yield format_sse(event)
    yield "data: [DONE]\n\n"


@router.post("/v1/audio/speech")
async def create_speech(request: Request) -> Response:
    body = await request.json()
    registry = request.app.state.registry
    model = select_default(registry, "audio.speech", body.get("model"))

    run_req = RunRequest(endpoint="audio.speech", model=model.spec.id, json=body, stream=body.get("stream"))
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
    response_format = body.get("response_format", "mp3")
    media_type = media_type_for(response_format)
    if body.get("stream"):
        if body.get("stream_format") == "sse":
            return StreamingResponse(_stream_sse(result), media_type="text/event-stream")
        return StreamingResponse(_stream_audio(result), media_type=media_type)
    return Response(content=result, media_type=media_type)
