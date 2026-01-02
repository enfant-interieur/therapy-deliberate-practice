from __future__ import annotations

from typing import AsyncIterator

from local_runtime.types import RunContext, RunRequest

SPEC = {
    "id": "local//stt/openai-proxy",
    "kind": "stt",
    "display": {
        "title": "OpenAI STT Proxy",
        "description": "Proxy to OpenAI for speech transcription/translation.",
        "tags": ["stt", "proxy", "openai"],
        "icon": "cloud",
    },
    "compat": {
        "platforms": ["darwin-arm64", "darwin-x64", "windows-x64", "linux-x64"],
        "acceleration": ["cpu"],
        "priority": 80,
        "requires_ram_gb": 2,
        "requires_vram_gb": 0,
        "disk_gb": 0,
    },
    "api": {
        "endpoint": "audio.translations",
        "advertised_model_name": "openai-stt",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 300,
        "concurrency": 4,
        "max_input_mb": 25,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "openai_proxy",
        "model_ref": "gpt-4o-mini-transcribe",
        "revision": None,
        "device_hint": "auto",
        "extra": {},
    },
    "execution": {
        "mode": "http_proxy",
        "warmup_on_start": False,
    },
    "launch": {
        "enabled": False,
        "type": "external",
        "explain": "Requires OPENAI_API_KEY and network access.",
        "env": {},
        "cmd": ["echo", "openai"],
        "ready": {
            "kind": "http",
            "timeout_sec": 60,
            "http_url": "http://127.0.0.1:{port}/health",
            "log_regex": "READY",
        },
    },
    "ui_params": [],
    "deps": {
        "python_extras": [],
        "pip": [],
        "system": [],
        "notes": "Uses OpenAI API when enabled.",
    },
}


async def run(req: RunRequest, ctx: RunContext):
    transcript = "This is a translated transcript."
    if req.stream:
        async def generator() -> AsyncIterator[dict]:
            for chunk in ["This is ", "a translated ", "transcript."]:
                yield {"event": "transcript.text.delta", "data": {"text": chunk}}
            yield {"event": "transcript.text.done", "data": {"text": transcript}}
        return generator()
    return {"text": transcript}
