from __future__ import annotations

from typing import AsyncIterator

from local_runtime.helpers.responses_helpers import new_response, stream_events
from local_runtime.types import RunContext, RunRequest

SPEC = {
    "id": "local//llm/ollama-proxy",
    "kind": "llm",
    "display": {
        "title": "Ollama Proxy",
        "description": "Proxy requests to a local Ollama server.",
        "tags": ["ollama", "proxy"],
        "icon": "cloud",
    },
    "compat": {
        "platforms": ["darwin-arm64", "darwin-x64", "windows-x64", "linux-x64"],
        "acceleration": ["cpu", "cuda", "metal"],
        "priority": 90,
        "requires_ram_gb": 8,
        "requires_vram_gb": 0,
        "disk_gb": 0,
    },
    "api": {
        "endpoint": "responses",
        "advertised_model_name": "ollama-proxy",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 300,
        "concurrency": 4,
        "max_input_mb": 25,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "ollama",
        "model_ref": "ollama://localhost",
        "revision": None,
        "device_hint": "auto",
        "extra": {"base_url": "http://127.0.0.1:11434"},
    },
    "execution": {
        "mode": "http_proxy",
        "warmup_on_start": False,
    },
    "launch": {
        "enabled": True,
        "type": "external",
        "explain": "Start Ollama separately and set OLLAMA_HOST if needed.",
        "env": {},
        "cmd": ["ollama", "serve"],
        "ready": {
            "kind": "http",
            "timeout_sec": 180,
            "http_url": "http://127.0.0.1:{port}/api/version",
            "log_regex": "READY",
        },
    },
    "ui_params": [],
    "deps": {
        "python_extras": [],
        "pip": [],
        "system": ["ollama"],
        "notes": "Requires Ollama running locally.",
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
    reply = f"(ollama proxy stub) You said: {prompt}"
    if req.stream:
        async def generator() -> AsyncIterator[dict]:
            for event, data in stream_events(req.model or SPEC["id"], reply):
                yield {"event": event, "data": data}
        return generator()
    return new_response(req.model or SPEC["id"], reply)
