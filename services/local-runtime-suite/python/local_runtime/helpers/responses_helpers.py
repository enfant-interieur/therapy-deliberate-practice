from __future__ import annotations

import time
import uuid


def new_response(model: str, output_text: str) -> dict:
    created = int(time.time())
    response_id = f"resp_{uuid.uuid4().hex}"
    output_item_id = f"output_{uuid.uuid4().hex}"
    return {
        "id": response_id,
        "object": "response",
        "created": created,
        "model": model,
        "output": [
            {
                "id": output_item_id,
                "object": "response.output_text",
                "type": "output_text",
                "text": output_text,
            }
        ],
    }


def stream_events(model: str, text: str):
    response = new_response(model, "")
    yield "response.created", response
    for chunk in [text[i : i + 30] for i in range(0, len(text), 30)]:
        yield "response.output_text.delta", {"id": response["id"], "delta": chunk}
    yield "response.output_text.done", {"id": response["id"], "text": text}
    yield "response.completed", response
