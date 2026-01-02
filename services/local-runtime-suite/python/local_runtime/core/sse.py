from __future__ import annotations

import json
from typing import Any


def format_sse(event: dict[str, Any]) -> str:
    payload = json.dumps(event, ensure_ascii=False)
    event_type = event.get("type")
    lines = []
    if event_type:
        lines.append(f"event: {event_type}")
    lines.append(f"data: {payload}")
    return "\n".join(lines) + "\n\n"
