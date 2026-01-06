from __future__ import annotations

import os
import uuid
from typing import AsyncIterator, Iterable

from local_runtime.helpers.multipart_helpers import UploadedFile

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


def _load_model(ctx: RunContext):
    if "faster_whisper_model" in ctx.model_state:
        return ctx.model_state["faster_whisper_model"]
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError("faster-whisper is not installed. Install it to enable local STT.") from exc
    model_name = os.getenv("LOCAL_RUNTIME_STT_MODEL", SPEC["backend"]["model_ref"])
    device = os.getenv("LOCAL_RUNTIME_STT_DEVICE", "cpu")
    compute_type = os.getenv("LOCAL_RUNTIME_STT_COMPUTE_TYPE", "int8")
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    ctx.model_state["faster_whisper_model"] = model
    return model


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


def _write_temp_audio(upload: UploadedFile, cache_dir: str) -> str:
    suffix = os.path.splitext(upload.filename or "")[1] or ".audio"
    filename = f"stt_{uuid.uuid4().hex}{suffix}"
    path = os.path.join(cache_dir, filename)
    with open(path, "wb") as handle:
        handle.write(upload.data)
    return path


def _segments_to_text(segments: Iterable) -> tuple[str, list[dict]]:
    transcript_chunks = []
    payload_segments: list[dict] = []
    for idx, segment in enumerate(segments):
        text = segment.text.strip()
        if text:
            transcript_chunks.append(text)
        payload_segments.append(
            {
                "id": idx,
                "start": float(segment.start),
                "end": float(segment.end),
                "text": segment.text,
            }
        )
    transcript = " ".join(transcript_chunks).strip()
    return transcript, payload_segments


async def run(req: RunRequest, ctx: RunContext):
    upload = _extract_upload(req)
    audio_path = _write_temp_audio(upload, ctx.cache_dir)
    try:
        model = _load_model(ctx)
        language = req.form.get("language") if req.form else None
        prompt = req.form.get("prompt") if req.form else None
        segments, info = model.transcribe(audio_path, language=language, initial_prompt=prompt)
        transcript, payload_segments = _segments_to_text(segments)
    finally:
        try:
            os.remove(audio_path)
        except OSError:
            ctx.logger.warning("Failed to clean up temp audio file: %s", audio_path)

    if req.stream:
        async def generator() -> AsyncIterator[dict]:
            for segment in payload_segments:
                if segment["text"]:
                    yield {"event": "transcript.text.delta", "data": {"text": segment["text"]}}
            yield {"event": "transcript.text.done", "data": {"text": transcript}}
        return generator()

    response = {"text": transcript, "segments": payload_segments}
    if info and getattr(info, "language", None):
        response["language"] = info.language
    return response
