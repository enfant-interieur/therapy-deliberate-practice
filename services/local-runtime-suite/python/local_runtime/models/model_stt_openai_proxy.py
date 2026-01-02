from __future__ import annotations

from local_runtime.types import RunRequest, RunContext

SPEC = {
    "id": "local/stt/openai-proxy",
    "kind": "stt",
    "display": {
        "title": "OpenAI Whisper Proxy",
        "description": "Proxy STT to OpenAI Whisper.",
        "tags": ["stt", "proxy"],
        "icon": "openai",
    },
    "compat": {
        "platforms": ["darwin-arm64", "darwin-x64", "windows-x64", "linux-x64"],
        "acceleration": ["cpu"],
        "priority": 80,
        "requires_ram_gb": 4,
        "requires_vram_gb": 0,
        "disk_gb": 0,
    },
    "api": {
        "endpoint": "audio.translations",
        "advertised_model_name": "openai-whisper",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 180,
        "concurrency": 1,
        "max_input_mb": 25,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "openai_proxy",
        "model_ref": "whisper-1",
        "device_hint": "auto",
        "extra": {},
    },
    "execution": {"mode": "http_proxy", "warmup_on_start": False},
    "launch": {
        "enabled": False,
        "type": "external",
        "explain": "Uses OpenAI API via configured key.",
        "env": {},
        "cmd": [],
        "ready": {"kind": "log", "timeout_sec": 30, "log_regex": "READY"},
    },
    "ui_params": [],
    "deps": {
        "python_extras": [],
        "pip": [],
        "system": [],
        "notes": "Requires OPENAI_API_KEY for proxy.",
    },
}


async def run(req: RunRequest, ctx: RunContext):
    transcript = "Hello from OpenAI Whisper"
    if req.stream:
        async def gen():
            yield {"type": "transcript.text.delta", "delta": transcript}
            yield {"type": "transcript.text.done", "text": transcript}
        return gen()
    response_format = (req.form or {}).get("response_format", "json")
    if response_format in {"text", "srt", "vtt"}:
        return transcript
    return {"text": transcript}
