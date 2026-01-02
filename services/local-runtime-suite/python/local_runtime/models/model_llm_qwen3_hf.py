from __future__ import annotations

from typing import AsyncIterator

from local_runtime.helpers.responses_helpers import new_response, stream_events
from local_runtime.types import RunContext, RunRequest

SPEC = {
    "id": "local//llm/qwen3-hf",
    "kind": "llm",
    "display": {
        "title": "Qwen3 Hugging Face",
        "description": "Local Qwen3 inference via Hugging Face Transformers.",
        "tags": ["qwen", "hf", "local"],
        "icon": "bolt",
    },
    "compat": {
        "platforms": ["darwin-arm64", "darwin-x64", "windows-x64", "linux-x64"],
        "acceleration": ["cpu", "cuda"],
        "priority": 100,
        "requires_ram_gb": 12,
        "requires_vram_gb": 6,
        "disk_gb": 8,
    },
    "api": {
        "endpoint": "responses",
        "advertised_model_name": "qwen3-hf",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 300,
        "concurrency": 1,
        "max_input_mb": 25,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "hf",
        "model_ref": "Qwen/Qwen3-4B-Instruct-2507",
        "revision": None,
        "device_hint": "auto",
        "extra": {},
    },
    "execution": {
        "mode": "subprocess",
        "warmup_on_start": False,
    },
    "launch": {
        "enabled": False,
        "type": "command",
        "explain": "HF models are run via worker subprocess.",
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
        "python_extras": ["hf"],
        "pip": ["torch", "transformers"],
        "system": [],
        "notes": "Requires torch + transformers.",
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
    prompt = _extract_prompt(req.json)
    reply = f"(local hf) You said: {prompt}"
    if req.stream:
        async def generator() -> AsyncIterator[dict]:
            for event, data in stream_events(req.model or SPEC["id"], reply):
                yield {"event": event, "data": data}
        return generator()
    return new_response(req.model or SPEC["id"], reply)
