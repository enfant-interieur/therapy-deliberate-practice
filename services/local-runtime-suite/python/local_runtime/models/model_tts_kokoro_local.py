from __future__ import annotations

from typing import AsyncIterator

from local_runtime.types import RunContext, RunRequest

SPEC = {
    "id": "local//tts/kokoro-local",
    "kind": "tts",
    "display": {
        "title": "Kokoro Local TTS",
        "description": "Offline Kokoro TTS for quick voice playback.",
        "tags": ["tts", "kokoro", "local"],
        "icon": "waveform",
    },
    "compat": {
        "platforms": ["darwin-arm64", "darwin-x64", "windows-x64", "linux-x64"],
        "acceleration": ["cpu", "cuda", "metal"],
        "priority": 110,
        "requires_ram_gb": 4,
        "requires_vram_gb": 0,
        "disk_gb": 2,
    },
    "api": {
        "endpoint": "audio.speech",
        "advertised_model_name": "kokoro-local",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 300,
        "concurrency": 2,
        "max_input_mb": 10,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "kokoro",
        "model_ref": "kokoro-82m",
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
        "explain": "Runs via worker subprocess.",
        "env": {},
        "cmd": ["python", "-m", "local_runtime"],
        "ready": {
            "kind": "http",
            "timeout_sec": 60,
            "http_url": "http://127.0.0.1:{port}/health",
            "log_regex": "READY",
        },
    },
    "ui_params": [
        {"key": "voice", "type": "select", "default": "af_bella", "choices": ["af_bella", "ff_siwis"], "min": None, "max": None}
    ],
    "deps": {
        "python_extras": ["tts"],
        "pip": [],
        "system": ["ffmpeg optional"],
        "notes": "Requires ffmpeg for some output formats.",
    },
}


async def run(req: RunRequest, ctx: RunContext):
    input_text = (req.json or {}).get("input", "")
    payload = f"KOKORO:{input_text}".encode("utf-8")
    if req.stream:
        async def generator() -> AsyncIterator[bytes]:
            for i in range(0, len(payload), 8):
                yield payload[i : i + 8]
        return generator()
    return payload
