from __future__ import annotations

from local_runtime.helpers.audio_helpers import generate_wav_bytes
from local_runtime.types import RunRequest, RunContext

SPEC = {
    "id": "local/tts/kokoro",
    "kind": "tts",
    "display": {
        "title": "Kokoro TTS",
        "description": "Local Kokoro voice synthesis.",
        "tags": ["tts", "kokoro"],
        "icon": "sound",
    },
    "compat": {
        "platforms": ["darwin-arm64", "darwin-x64", "windows-x64", "linux-x64"],
        "acceleration": ["cpu"],
        "priority": 100,
        "requires_ram_gb": 4,
        "requires_vram_gb": 0,
        "disk_gb": 2,
    },
    "api": {
        "endpoint": "audio.speech",
        "advertised_model_name": "kokoro",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 120,
        "concurrency": 1,
        "max_input_mb": 25,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "kokoro",
        "model_ref": "kokoro-v1",
        "device_hint": "cpu",
        "extra": {},
    },
    "execution": {"mode": "inprocess", "warmup_on_start": False},
    "launch": None,
    "ui_params": [
        {"key": "voice", "type": "select", "default": "aria", "choices": ["aria", "nova"]}
    ],
    "deps": {
        "python_extras": ["tts"],
        "pip": [],
        "system": [],
        "notes": "Local CPU voice synthesis.",
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
