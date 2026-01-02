from __future__ import annotations

from local_runtime.helpers.audio_helpers import generate_wav_bytes
from local_runtime.types import RunRequest, RunContext

SPEC = {
    "id": "local/tts/openai-proxy",
    "kind": "tts",
    "display": {
        "title": "OpenAI TTS Proxy",
        "description": "Proxy TTS to OpenAI.",
        "tags": ["tts", "proxy"],
        "icon": "openai",
    },
    "compat": {
        "platforms": ["darwin-arm64", "darwin-x64", "windows-x64", "linux-x64"],
        "acceleration": ["cpu"],
        "priority": 50,
        "requires_ram_gb": 2,
        "requires_vram_gb": 0,
        "disk_gb": 0,
    },
    "api": {
        "endpoint": "audio.speech",
        "advertised_model_name": "openai-tts",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 120,
        "concurrency": 1,
        "max_input_mb": 25,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "openai_proxy",
        "model_ref": "gpt-4o-mini-tts",
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
    text = req.json.get("input", "Hello") if req.json else "Hello"
    audio = generate_wav_bytes(text)
    if req.stream:
        async def gen():
            chunk_size = 2048
            for idx in range(0, len(audio), chunk_size):
                yield audio[idx : idx + chunk_size]
        return gen()
    return audio
