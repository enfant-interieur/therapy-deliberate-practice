from __future__ import annotations

import asyncio
import os
import tempfile
import threading
import time
from collections.abc import AsyncIterator
from typing import Any

from local_runtime.cancellation import CancellationToken, acquire_model_lock
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
        "acceleration": ["cpu"],
        "priority": 120,
        "requires_ram_gb": 6,
        "requires_vram_gb": 0,
        "disk_gb": 4,
    },
    "api": {
        "endpoint": "audio.transcriptions",
        "advertised_model_name": "faster-whisper",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 300,
        "concurrency": 1,
        "max_input_mb": 25,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "faster_whisper",
        "model_ref": "base",
        "revision": "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66",
        "device_hint": "auto",
        "extra": {},
    },
    "execution": {
        "mode": "inprocess",
        "warmup_on_start": False,
    },
    "launch": {
        "enabled": False,
        "type": "command",
        "explain": "Runs in-process with serialized access to the local transcription model.",
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
        "pip": ["faster-whisper==1.2.1", "onnxruntime==1.23.2"],
        "system": [],
        "notes": (
            "The packaged desktop runtime uses CPU inference and PyAV for audio decoding. "
            "ONNX Runtime 1.23.2 retains Python 3.12 wheels for every packaged desktop target."
        ),
    },
}


def load(ctx: RunContext) -> dict[str, Any]:
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "Faster Whisper is not installed in this runtime. Reinstall the desktop local runtime."
        ) from exc
    model_ref = os.getenv("LOCAL_RUNTIME_FASTER_WHISPER_MODEL", SPEC["backend"]["model_ref"])
    revision = os.getenv("LOCAL_RUNTIME_FASTER_WHISPER_REVISION") or SPEC["backend"]["revision"]
    device = os.getenv("LOCAL_RUNTIME_FASTER_WHISPER_DEVICE", "auto")
    compute_type = os.getenv("LOCAL_RUNTIME_FASTER_WHISPER_COMPUTE_TYPE", "default")
    ctx.logger.info(
        "faster_whisper.load.start",
        extra={
            "model_id": SPEC["id"],
            "model_ref": model_ref,
            "revision": revision,
            "device": device,
            "compute_type": compute_type,
        },
    )
    try:
        model = WhisperModel(
            model_ref,
            device=device,
            compute_type=compute_type,
            revision=revision,
            download_root=ctx.cache_dir,
        )
    except Exception as exc:
        raise RuntimeError(
            f"Faster Whisper could not load the '{model_ref}' model. Check available disk space and retry."
        ) from exc
    ctx.logger.info(
        "faster_whisper.load.ready",
        extra={"model_id": SPEC["id"], "model_ref": model_ref, "revision": revision},
    )
    return {
        "model": model,
        "model_ref": model_ref,
        "revision": revision,
        "lock": threading.Lock(),
    }


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
        raise TypeError("Invalid audio payload.")
    return UploadedFile(filename=filename, content_type=content_type, data=bytes(data))


def _write_temp_audio(upload: UploadedFile, cache_dir: str) -> str:
    os.makedirs(cache_dir, exist_ok=True)
    suffix = os.path.splitext(upload.filename or "")[1].lower()
    if not suffix or len(suffix) > 8 or not suffix[1:].isalnum():
        suffix = ".audio"
    with tempfile.NamedTemporaryFile(
        mode="wb",
        suffix=suffix,
        prefix="faster-whisper-",
        dir=cache_dir,
        delete=False,
    ) as handle:
        handle.write(upload.data)
        return handle.name


def _serialize_segment(segment: Any, index: int) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": index,
        "start": float(getattr(segment, "start", 0.0)),
        "end": float(getattr(segment, "end", 0.0)),
        "text": str(getattr(segment, "text", "") or "").strip(),
    }
    words = getattr(segment, "words", None)
    if words:
        payload["words"] = [
            {
                "word": str(getattr(word, "word", "") or ""),
                "start": float(getattr(word, "start", 0.0)),
                "end": float(getattr(word, "end", 0.0)),
                "probability": float(getattr(word, "probability", 0.0)),
            }
            for word in words
        ]
    return payload


def _transcribe_sync(
    instance: dict[str, Any],
    audio_path: str,
    *,
    language: str | None,
    prompt: str | None,
    token: CancellationToken | None = None,
) -> tuple[str, list[dict[str, Any]], str | None, float | None]:
    beam_size = max(1, int(os.getenv("LOCAL_RUNTIME_FASTER_WHISPER_BEAM_SIZE", "5")))
    if token is not None:
        token.raise_if_cancelled()
    with acquire_model_lock(instance["lock"], token):
        segments_iter, info = instance["model"].transcribe(
            audio_path,
            language=language or None,
            initial_prompt=prompt or None,
            beam_size=beam_size,
            vad_filter=True,
            word_timestamps=True,
        )
        segments = []
        for index, segment in enumerate(segments_iter):
            if token is not None:
                token.raise_if_cancelled()
            segments.append(_serialize_segment(segment, index))
    if token is not None:
        token.raise_if_cancelled()
    text = " ".join(segment["text"] for segment in segments if segment["text"]).strip()
    detected_language = getattr(info, "language", None)
    language_probability = getattr(info, "language_probability", None)
    return (
        text,
        segments,
        str(detected_language) if detected_language else None,
        float(language_probability) if language_probability is not None else None,
    )


async def run(req: RunRequest, ctx: RunContext):
    model_id = req.model or SPEC["id"]
    instance = await ctx.registry.ensure_instance(model_id, ctx)
    if not instance:
        raise RuntimeError("Faster Whisper model is not initialized.")
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
    audio_path = _write_temp_audio(upload, ctx.cache_dir)
    try:
        transcript, payload_segments, detected_language, language_probability = await asyncio.to_thread(
            _transcribe_sync,
            instance,
            audio_path,
            language=language,
            prompt=prompt,
            token=ctx.cancellation_token,
        )
    finally:
        try:
            os.remove(audio_path)
        except OSError:
            ctx.logger.warning(
                "faster_whisper.temp_cleanup_failed",
                extra={"model_id": model_id},
            )
    ctx.logger.info(
        "faster_whisper.run.output",
        extra={
            **run_meta,
            "segments": len(payload_segments),
            "text_chars": len(transcript),
            "detected_language": detected_language,
        },
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

    response = {
        "text": transcript,
        "segments": payload_segments,
        "language": detected_language or language,
    }
    if language_probability is not None:
        response["language_probability"] = language_probability
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    ctx.logger.info("faster_whisper.run.complete", extra={**run_meta, "duration_ms": duration_ms})
    return response
