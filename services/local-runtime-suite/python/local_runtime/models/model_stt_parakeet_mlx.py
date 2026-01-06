from __future__ import annotations

import os
import uuid
from typing import AsyncIterator, Iterable

from local_runtime.helpers.multipart_helpers import UploadedFile
from local_runtime.types import RunContext, RunRequest

SPEC = {
    "id": "local//stt/parakeet-mlx",
    "kind": "stt",
    "display": {
        "title": "Parakeet MLX",
        "description": "Local MLX speech-to-text via the Parakeet TDT model.",
        "tags": ["stt", "mlx", "local"],
        "icon": "mic",
    },
    "compat": {
        "platforms": ["darwin-arm64"],
        "acceleration": ["metal"],
        "priority": 130,
        "requires_ram_gb": 8,
        "requires_vram_gb": 0,
        "disk_gb": 6,
    },
    "api": {
        "endpoint": "audio.transcriptions",
        "advertised_model_name": "parakeet-mlx",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 300,
        "concurrency": 1,
        "max_input_mb": 25,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "mlx",
        "model_ref": "mlx-community/parakeet-tdt-0.6b-v2",
        "revision": None,
        "device_hint": "metal",
        "extra": {},
    },
    "execution": {
        "mode": "inprocess",
        "warmup_on_start": False,
    },
    "launch": {
        "enabled": False,
        "type": "command",
        "explain": "MLX runs in-process.",
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
        "python_extras": ["mlx", "stt"],
        "pip": ["mlx-whisper"],
        "system": [],
        "notes": "Requires mlx-whisper for MLX transcription.",
    },
}


def _load_model(ctx: RunContext):
    if "parakeet_mlx_model" in ctx.model_state:
        return ctx.model_state["parakeet_mlx_model"]
    try:
        import mlx_whisper
    except ImportError as exc:
        raise RuntimeError("mlx-whisper is not installed. Install it to enable MLX STT.") from exc
    model_name = os.getenv("LOCAL_RUNTIME_STT_MODEL", SPEC["backend"]["model_ref"])
    if hasattr(mlx_whisper, "load_model"):
        model = mlx_whisper.load_model(model_name)
    elif hasattr(mlx_whisper, "load"):
        model = mlx_whisper.load(model_name)
    else:
        raise RuntimeError("mlx-whisper load method not found.")
    ctx.model_state["parakeet_mlx_model"] = (model, mlx_whisper)
    return model, mlx_whisper


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
        if isinstance(segment, dict):
            text = str(segment.get("text") or "").strip()
            start = float(segment.get("start", 0.0))
            end = float(segment.get("end", 0.0))
        else:
            text = str(getattr(segment, "text", "") or "").strip()
            start = float(getattr(segment, "start", 0.0))
            end = float(getattr(segment, "end", 0.0))
        if text:
            transcript_chunks.append(text)
        payload_segments.append({"id": idx, "start": start, "end": end, "text": text})
    transcript = " ".join(transcript_chunks).strip()
    return transcript, payload_segments


def _transcribe_audio(model, mlx_whisper, audio_path: str, language: str | None, prompt: str | None):
    if hasattr(model, "transcribe"):
        try:
            return model.transcribe(audio_path, language=language, prompt=prompt, initial_prompt=prompt)
        except TypeError:
            return model.transcribe(audio_path)
    if hasattr(mlx_whisper, "transcribe"):
        try:
            return mlx_whisper.transcribe(model, audio_path, language=language, prompt=prompt, initial_prompt=prompt)
        except TypeError:
            return mlx_whisper.transcribe(model, audio_path)
    raise RuntimeError("mlx-whisper transcribe method not found.")


def _parse_transcribe_result(result) -> tuple[str, list[dict]]:
    if isinstance(result, dict):
        text = str(result.get("text") or "").strip()
        segments = result.get("segments") or []
        transcript, payload_segments = _segments_to_text(segments)
        return text or transcript, payload_segments
    if isinstance(result, tuple) and len(result) >= 2:
        transcript, payload_segments = _segments_to_text(result[0])
        return transcript, payload_segments
    return str(result or ""), []


async def run(req: RunRequest, ctx: RunContext):
    upload = _extract_upload(req)
    audio_path = _write_temp_audio(upload, ctx.cache_dir)
    try:
        model, mlx_whisper = _load_model(ctx)
        language = req.form.get("language") if req.form else None
        prompt = req.form.get("prompt") if req.form else None
        result = _transcribe_audio(model, mlx_whisper, audio_path, language, prompt)
        transcript, payload_segments = _parse_transcribe_result(result)
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

    return {"text": transcript, "segments": payload_segments}
