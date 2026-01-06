from __future__ import annotations

import time
import uuid


def new_response(model: str, output_text: str, request_id: str | None = None) -> dict:
    created = int(time.time())
    response_id = f"resp_{uuid.uuid4().hex}"
    output_item_id = f"output_{uuid.uuid4().hex}"
    content_item_id = f"content_{uuid.uuid4().hex}"
    payload = {
        "id": response_id,
        "request_id": request_id,
        "_request_id": request_id,
        "object": "response",
        "created": created,
        "model": model,
        "output_text": output_text,
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
    return payload


def stream_events(model: str, text: str, request_id: str | None = None):
    response = new_response(model, "", request_id=request_id)
    yield "response.created", response
    for chunk in [text[i : i + 30] for i in range(0, len(text), 30)]:
        yield "response.output_text.delta", {"id": response["id"], "delta": chunk}
    yield "response.output_text.done", {"id": response["id"], "text": text}
    yield "response.completed", response
