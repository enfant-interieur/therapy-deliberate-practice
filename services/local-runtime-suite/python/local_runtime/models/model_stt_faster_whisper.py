from __future__ import annotations

from local_runtime.types import RunRequest, RunContext

SPEC = {
    "id": "local/stt/faster-whisper",
    "kind": "stt",
    "display": {
        "title": "Faster Whisper",
        "description": "Local speech-to-text with Faster Whisper.",
        "tags": ["stt", "whisper"],
        "icon": "mic",
    },
    "compat": {
        "platforms": ["darwin-arm64", "darwin-x64", "windows-x64", "linux-x64"],
        "acceleration": ["cuda", "cpu"],
        "priority": 100,
        "requires_ram_gb": 8,
        "requires_vram_gb": 4,
        "disk_gb": 4,
    },
    "api": {
        "endpoint": "audio.transcriptions",
        "advertised_model_name": "faster-whisper",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 180,
        "concurrency": 1,
        "max_input_mb": 25,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "faster_whisper",
        "model_ref": "base",
        "device_hint": "auto",
        "extra": {},
    },
    "execution": {"mode": "subprocess", "warmup_on_start": False},
    "launch": {
        "enabled": True,
        "type": "command",
        "explain": "Launch Faster Whisper worker.",
        "env": {},
        "cmd": ["python", "-m", "local_runtime.workers.stt_worker"],
        "ready": {"kind": "log", "timeout_sec": 180, "log_regex": "READY"},
    },
    "ui_params": [],
    "deps": {
        "python_extras": ["stt"],
        "pip": [],
        "system": ["ffmpeg"],
        "notes": "Requires ffmpeg and GPU for best performance.",
    },
}


async def run(req: RunRequest, ctx: RunContext):
    transcript = "Hello from Faster Whisper"
    if req.stream:
        async def gen():
            yield {"type": "transcript.text.delta", "delta": transcript}
            yield {"type": "transcript.text.done", "text": transcript}
        return gen()
    response_format = (req.form or {}).get("response_format", "json")
    if response_format in {"text", "srt", "vtt"}:
        return transcript
    return {"text": transcript}
