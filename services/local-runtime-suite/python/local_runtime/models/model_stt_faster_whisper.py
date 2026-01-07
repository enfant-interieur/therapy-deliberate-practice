from __future__ import annotations

import time
from typing import AsyncIterator

from local_runtime.helpers.multipart_helpers import UploadedFile
from local_runtime.runtime_types import RunContext, RunRequest

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


def load(ctx: RunContext) -> dict:
    ctx.logger.info("faster_whisper.load", extra={"model_id": SPEC["id"]})
    return {"status": "ready"}


def _extract_upload(req: RunRequest) -> UploadedFile:
    if not req.files or "file" not in req.files:
        raise ValueError("Missing audio file.")
    file_entry = req.files["file"]
    if isinstance(file_entry, dict):
        filename = file_entry.get("filename") or "audio"
        content_type = file_entry.get("content_type") or "application/octet-stream"
        data = file_entry.get("data")
    else:
        filename = getattr(file_entry, "filename", "audio")
        content_type = getattr(file_entry, "content_type", "application/octet-stream")
        data = getattr(file_entry, "data", None)
    if not isinstance(data, (bytes, bytearray)):
        raise ValueError("Invalid audio payload.")
    return UploadedFile(filename=filename, content_type=content_type, data=bytes(data))


def _fake_transcription(upload: UploadedFile, language: str | None, prompt: str | None) -> tuple[str, list[dict]]:
    text = f"[{SPEC['display']['title']}] {upload.filename or 'audio'} len={len(upload.data)}"
    if language:
        text += f" lang={language}"
    if prompt:
        text += " prompt"
    segment = {"id": 0, "start": 0.0, "end": 0.5, "text": text}
    return text, [segment]


async def run(req: RunRequest, ctx: RunContext):
    model_id = req.model or SPEC["id"]
    await ctx.registry.ensure_instance(model_id, ctx)
    upload = _extract_upload(req)
    language = req.form.get("language") if req.form else None
    prompt = req.form.get("prompt") if req.form else None
    run_meta = {
        "model_id": model_id,
        "stream": bool(req.stream),
        "language": language,
        "input_bytes": len(upload.data),
    }
    ctx.logger.info("faster_whisper.run.start", extra=run_meta)
    start = time.perf_counter()
    transcript, payload_segments = _fake_transcription(upload, language, prompt)
    ctx.logger.info(
        "faster_whisper.run.output",
        extra={**run_meta, "text": transcript, "segments": len(payload_segments)},
    )

    if req.stream:
        async def generator() -> AsyncIterator[dict]:
            for segment in payload_segments:
                if segment["text"]:
                    yield {"event": "transcript.text.delta", "data": {"text": segment["text"]}}
            yield {"event": "transcript.text.done", "data": {"text": transcript}}
        async def tracked() -> AsyncIterator[dict]:
            try:
                async for event in generator():
                    yield event
            finally:
                duration_ms = round((time.perf_counter() - start) * 1000, 2)
                ctx.logger.info("faster_whisper.run.complete", extra={**run_meta, "duration_ms": duration_ms})

        return tracked()

    response = {"text": transcript, "segments": payload_segments}
    if language:
        response["language"] = language
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    ctx.logger.info("faster_whisper.run.complete", extra={**run_meta, "duration_ms": duration_ms})
    return response
