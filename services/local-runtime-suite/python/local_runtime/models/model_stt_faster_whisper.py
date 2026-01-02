from __future__ import annotations

from typing import AsyncIterator

from local_runtime.types import RunContext, RunRequest

SPEC = {
    "id": "local//stt/faster-whisper",
    "kind": "stt",
    "display": {
        "title": "Faster Whisper",
        "description": "Local Whisper transcription for quick offline audio-to-text.",
        "tags": ["stt", "whisper", "local"],
        "icon": "mic",
    },
    "compat": {
        "platforms": ["darwin-arm64", "darwin-x64", "windows-x64", "linux-x64"],
        "acceleration": ["cpu", "cuda", "metal"],
        "priority": 120,
        "requires_ram_gb": 6,
        "requires_vram_gb": 4,
        "disk_gb": 4,
    },
    "api": {
        "endpoint": "audio.transcriptions",
        "advertised_model_name": "faster-whisper",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 300,
        "concurrency": 2,
        "max_input_mb": 25,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "faster_whisper",
        "model_ref": "base",
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
    "ui_params": [],
    "deps": {
        "python_extras": ["stt"],
        "pip": ["faster-whisper"],
        "system": ["ffmpeg"],
        "notes": "Requires ffmpeg for decoding audio input.",
    },
}


async def run(req: RunRequest, ctx: RunContext):
    transcript = "This is a local transcript."
    if req.stream:
        async def generator() -> AsyncIterator[dict]:
            for chunk in ["This is ", "a local ", "transcript."]:
                yield {"event": "transcript.text.delta", "data": {"text": chunk}}
            yield {"event": "transcript.text.done", "data": {"text": transcript}}
        return generator()
    return {"text": transcript}
