from __future__ import annotations

import asyncio
import uuid
from typing import Any, AsyncIterator

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
import httpx

from local_runtime.core.selector import select_default
from local_runtime.core.sse import format_sse
from local_runtime.core.platform import current_platform
from local_runtime.types import RunContext, RunRequest

router = APIRouter()


async def _stream_events(events: AsyncIterator[dict[str, Any]]) -> AsyncIterator[str]:
    async for event in events:
        yield format_sse(event)
    yield "data: [DONE]\n\n"


@router.post("/v1/responses")
async def create_response(request: Request) -> StreamingResponse | JSONResponse:
    body = await request.json()
    registry = request.app.state.registry
    model_name = body.get("model")
    model = select_default(registry, "responses", model_name)

    run_req = RunRequest(endpoint="responses", model=model.spec.id, json=body, stream=body.get("stream"))
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
    if body.get("stream"):
        return StreamingResponse(_stream_events(result), media_type="text/event-stream")
    return JSONResponse(result)
