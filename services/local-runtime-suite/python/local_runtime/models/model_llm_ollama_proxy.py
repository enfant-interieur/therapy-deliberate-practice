from __future__ import annotations

from local_runtime.helpers.responses_helpers import build_response, build_stream_events
from local_runtime.types import RunRequest, RunContext

SPEC = {
    "id": "local/llm/ollama-proxy",
    "kind": "llm",
    "display": {
        "title": "Ollama Proxy",
        "description": "Proxy to a local Ollama instance.",
        "tags": ["llm", "ollama"],
        "icon": "ollama",
    },
    "compat": {
        "platforms": ["darwin-arm64", "darwin-x64", "windows-x64", "linux-x64"],
        "acceleration": ["cpu", "cuda"],
        "priority": 80,
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
        "concurrency": 1,
        "max_input_mb": 25,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "ollama",
        "model_ref": "llama3",
        "device_hint": "auto",
        "extra": {"base_url": "http://127.0.0.1:11434"},
    },
    "execution": {"mode": "http_proxy", "warmup_on_start": False},
    "launch": {
        "enabled": True,
        "type": "external",
        "explain": "Ensure Ollama is running on http://127.0.0.1:11434",
        "env": {},
        "cmd": [],
        "ready": {"kind": "http", "timeout_sec": 180, "http_url": "http://127.0.0.1:11434"},
    },
    "ui_params": [],
    "deps": {
        "python_extras": [],
        "pip": [],
        "system": [],
        "notes": "Requires Ollama installed.",
    },
}


async def run(req: RunRequest, ctx: RunContext):
    prompt = req.json.get("input", "Hello") if req.json else "Hello"
    text = f"[ollama-proxy] {prompt}"
    if req.stream:
        async def gen():
            for event in build_stream_events(text, SPEC["id"]):
                yield event
        return gen()
    return build_response(text, SPEC["id"])
