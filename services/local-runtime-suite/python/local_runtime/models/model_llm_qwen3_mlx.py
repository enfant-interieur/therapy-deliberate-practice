from __future__ import annotations

from typing import AsyncIterator

from local_runtime.helpers.responses_helpers import new_response, stream_events
from local_runtime.types import RunContext, RunRequest

SPEC = {
    "id": "local//llm/qwen3-mlx",
    "kind": "llm",
    "display": {
        "title": "Qwen3 MLX",
        "description": "Local Qwen3 inference via MLX on Apple Silicon.",
        "tags": ["qwen", "mlx", "local"],
        "icon": "cpu",
    },
    "compat": {
        "platforms": ["darwin-arm64"],
        "acceleration": ["metal"],
        "priority": 120,
        "requires_ram_gb": 8,
        "requires_vram_gb": 0,
        "disk_gb": 6,
    },
    "api": {
        "endpoint": "responses",
        "advertised_model_name": "qwen3-mlx",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 300,
        "concurrency": 1,
        "max_input_mb": 25,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "mlx",
        "model_ref": "Qwen/Qwen3-4B-MLX-4bit",
        "revision": None,
        "device_hint": "metal",
        "extra": {},
    },
    "execution": {
        "mode": "inprocess",
        "warmup_on_start": False,
    },
    "launch": {
        "enabled": False,
        "type": "command",
        "explain": "MLX runs in-process.",
        "env": {},
        "cmd": ["python", "-m", "local_runtime"],
        "ready": {
            "kind": "http",
            "timeout_sec": 60,
            "http_url": "http://127.0.0.1:{port}/health",
            "log_regex": "READY",
        },
    },
    "ui_params": [],
    "deps": {
        "python_extras": ["mlx"],
        "pip": [],
        "system": [],
        "notes": "Requires Apple Silicon with MLX support.",
    },
}


def _extract_prompt(payload: dict | None) -> str:
    if not payload:
        return "Hello from local runtime."
    if isinstance(payload.get("input"), str):
        return payload["input"]
    if isinstance(payload.get("input"), list) and payload["input"]:
        first = payload["input"][0]
        if isinstance(first, dict) and "content" in first:
            return str(first["content"])
    return "Hello from local runtime."


async def run(req: RunRequest, ctx: RunContext):
    prompt = _extract_prompt(req.payload)
    reply = f"(local mlx) You said: {prompt}"
    if req.stream:
        async def generator() -> AsyncIterator[dict]:
            for event, data in stream_events(req.model or SPEC["id"], reply, request_id=ctx.request_id):
                yield {"event": event, "data": data}
        return generator()
    return new_response(req.model or SPEC["id"], reply, request_id=ctx.request_id)
