from __future__ import annotations

import time
import uuid


def build_response(text: str, model: str) -> dict:
    response_id = f"resp_{uuid.uuid4().hex[:8]}"
    return {
        "id": response_id,
        "object": "response",
        "created": int(time.time()),
        "model": model,
        "output": [
            {
                "id": "msg_0",
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": text}],
            }
        ],
    }


def build_stream_events(text: str, model: str) -> list[dict]:
    response = build_response(text, model)
    response_id = response["id"]
    return [
        {"type": "response.created", "response": response},
        {
            "type": "response.output_text.delta",
            "response_id": response_id,
            "delta": text,
        },
        {"type": "response.completed", "response": response},
    ]
