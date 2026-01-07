from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any, AsyncIterator, Iterable

from fastapi.responses import JSONResponse, PlainTextResponse, Response, StreamingResponse

from local_runtime.core.loader import LoadedModel


def _build_response_payload(model: str, output_text: str, request_id: str | None = None, created_ts: int | None = None) -> dict:
    created = created_ts or int(time.time())
    response_id = f"resp_{uuid.uuid4().hex}"
    output_item_id = f"output_{uuid.uuid4().hex}"
    content_item_id = f"content_{uuid.uuid4().hex}"
    return {
        "id": response_id,
        "request_id": request_id,
        "_request_id": request_id,
        "object": "response",
        "created": created,
        "model": model,
        "output": [
            {
                "id": output_item_id,
                "object": "response.output_message",
                "type": "message",
                "role": "assistant",
                "content": [
                    {
                        "id": content_item_id,
                        "type": "output_text",
                        "text": output_text,
                    }
                ],
            }
        ],
    }


def format_responses_create(result: Any, model: str, request_id: str | None = None, created_ts: int | None = None) -> dict:
    """Normalize a model result into the OpenAI Responses API schema."""
    if isinstance(result, dict):
        payload = dict(result)
        payload.setdefault("object", "response")
        payload.setdefault("model", model)
        payload.setdefault("created", created_ts or int(time.time()))
        payload.setdefault("id", f"resp_{uuid.uuid4().hex}")
        if request_id:
            payload.setdefault("request_id", request_id)
            payload.setdefault("_request_id", request_id)
        return payload
    return _build_response_payload(model, str(result), request_id=request_id, created_ts=created_ts)


async def format_responses_stream(events_iter: AsyncIterator[dict]) -> AsyncIterator[str]:
    """Render SSE output for Responses stream events."""
    async for payload in events_iter:
        event = payload.get("event", "message")
        data = payload.get("data", {})
        json_payload = json.dumps(data, ensure_ascii=False)
        yield f"event: {event}\ndata: {json_payload}\n\n"


def format_audio_speech_response(data: Any, content_type: str, stream: bool) -> Response:
    """Ensure audio responses consistently match OpenAI expectations."""
    if stream:
        if isinstance(data, (bytes, bytearray)):
            async def _single_chunk(payload: bytes | bytearray):
                yield bytes(payload)

            body = _single_chunk(data)
        else:
            body = data
        return StreamingResponse(body, media_type=content_type)
    payload_bytes = data if isinstance(data, (bytes, bytearray)) else bytes(data or b"")
    return Response(content=payload_bytes, media_type=content_type)


def format_audio_transcription_response(result: Any, response_format: str, stream: bool):
    """Deliver transcription/translation payloads that mirror OpenAI Audio API."""
    if stream:
        return StreamingResponse(format_responses_stream(result), media_type="text/event-stream")
    if response_format in {"text", "srt", "vtt"}:
        text_value = result if isinstance(result, str) else str(result.get("text", ""))
        return PlainTextResponse(text_value or "", media_type="text/plain")
    payload = result if isinstance(result, dict) else {"text": str(result)}
    payload.setdefault("text", payload.get("text", ""))
    return JSONResponse(payload)


def format_models_list(models: Iterable[LoadedModel], created_ts: int) -> dict:
    """Return an OpenAI-style list of loaded models."""
    data = []
    for loaded in models:
        spec = loaded.spec
        data.append(
            {
                "id": spec.id,
                "object": "model",
                "created": created_ts,
                "owned_by": "local-runtime",
                "metadata": {
                    "kind": spec.kind,
                    "api": spec.api.model_dump(),
                    "display": spec.display.model_dump(),
                    "compat": spec.compat.model_dump(),
                    "backend": spec.backend.model_dump(),
                    "execution": spec.execution.model_dump(),
                },
            }
        )
    return {"object": "list", "data": data}


def format_error(message: str, *, err_type: str = "server_error", code: str | None = None, status_code: int | None = None) -> JSONResponse:
    """Render an OpenAI-compatible error payload."""
    payload = {"error": {"message": message, "type": err_type, "param": None, "code": code}}
    if status_code is not None:
        status = status_code
    elif err_type == "invalid_request_error":
        status = 400
    elif err_type == "not_found":
        status = 404
    else:
        status = 500
    return JSONResponse(payload, status_code=status)
