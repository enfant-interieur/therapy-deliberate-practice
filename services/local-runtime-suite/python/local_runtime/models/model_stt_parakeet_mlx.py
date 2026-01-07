from __future__ import annotations

import asyncio
import os
import time
import uuid
from typing import Any, AsyncIterator

from local_runtime.helpers.multipart_helpers import UploadedFile
from local_runtime.runtime_types import RunContext, RunRequest

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
        "model_ref": "mlx-community/parakeet-tdt-0.6b-v3",
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
        "pip": ["parakeet-mlx>=0.2.0"],
        "system": [],
        "notes": "Requires parakeet-mlx for transcription.",
    },
}

DEFAULT_CHUNK_SECONDS = float(os.getenv("LOCAL_RUNTIME_STT_CHUNK_SEC", "120"))
DEFAULT_OVERLAP_SECONDS = float(os.getenv("LOCAL_RUNTIME_STT_OVERLAP_SEC", "15"))


def load(ctx: RunContext) -> dict[str, Any]:
    try:
        from parakeet_mlx import from_pretrained  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "parakeet-mlx is required for MLX transcription. Install with `pip install parakeet-mlx`."
        ) from exc
    model_name = os.getenv("LOCAL_RUNTIME_STT_MODEL", SPEC["backend"]["model_ref"])
    ctx.logger.info("parakeet_mlx.load", extra={"model_id": SPEC["id"], "model_ref": model_name})
    model = from_pretrained(model_name)

    if os.getenv("LOCAL_RUNTIME_STT_LOCAL_ATTENTION", "0").lower() in {"1", "true", "yes"}:
        encoder = getattr(model, "encoder", None)
        if encoder and hasattr(encoder, "set_attention_model"):
            encoder.set_attention_model("rel_pos_local_attn", (256, 256))

    return {"model": model}


def warmup(instance: dict[str, Any], ctx: RunContext) -> None:
    ctx.logger.info("parakeet_mlx.warmup", extra={"model_id": SPEC["id"]})


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
    suffix = os.path.splitext(upload.filename or "")[1] or ".wav"
    filename = f"stt_{uuid.uuid4().hex}{suffix}"
    path = os.path.join(cache_dir, filename)
    with open(path, "wb") as handle:
        handle.write(upload.data)
    return path


def _build_decoding_config():
    try:
        from parakeet_mlx import DecodingConfig, SentenceConfig  # type: ignore
    except ImportError:
        return None

    return DecodingConfig(
        sentence=SentenceConfig(
            max_words=int(os.getenv("LOCAL_RUNTIME_STT_SENTENCE_MAX_WORDS", "30")),
            silence_gap=float(os.getenv("LOCAL_RUNTIME_STT_SENTENCE_SILENCE_GAP", "4.0")),
            max_duration=float(os.getenv("LOCAL_RUNTIME_STT_SENTENCE_MAX_DURATION", "40.0")),
        )
    )


async def _run_transcribe(model, audio_path: str, chunk_duration: float, overlap_duration: float, decoding_config, language: str | None):
    def _invoke():
        kwargs: dict[str, Any] = {
            "audio": audio_path,
            "chunk_duration": chunk_duration,
            "overlap_duration": overlap_duration,
        }
        if decoding_config:
            kwargs["decoding_config"] = decoding_config
        if language:
            kwargs["language"] = language
        return model.transcribe(**kwargs)

    return await asyncio.to_thread(_invoke)


def _parse_result(result) -> tuple[str, list[dict]]:
    text = ""
    segments: list[dict] = []
    if hasattr(result, "text"):
        text = str(getattr(result, "text", "") or "")
    if hasattr(result, "sentences"):
        for idx, sentence in enumerate(getattr(result, "sentences") or []):
            segment_text = str(getattr(sentence, "text", "") or "").strip()
            start = float(getattr(sentence, "start", 0.0))
            end = float(getattr(sentence, "end", start))
            if segment_text:
                segments.append({"id": idx, "start": start, "end": end, "text": segment_text})
    if not text and segments:
        text = " ".join(segment["text"] for segment in segments).strip()
    return text, segments


async def run(req: RunRequest, ctx: RunContext):
    upload = _extract_upload(req)
    audio_path = _write_temp_audio(upload, ctx.cache_dir)
    model_id = req.model or SPEC["id"]
    instance = await ctx.registry.ensure_instance(model_id, ctx)
    if not instance:
        raise RuntimeError("Parakeet MLX model is not initialized.")

    form_data = req.form or {}
    decoding_config = _build_decoding_config()
    chunk_duration = float(form_data.get("chunk_duration", DEFAULT_CHUNK_SECONDS))
    overlap_duration = float(form_data.get("overlap_duration", DEFAULT_OVERLAP_SECONDS))
    language = form_data.get("language")

    run_meta = {
        "model_id": model_id,
        "stream": bool(req.stream),
        "input_bytes": len(upload.data),
        "chunk_duration": chunk_duration,
        "overlap_duration": overlap_duration,
    }
    ctx.logger.info("parakeet_mlx.run.start", extra=run_meta)
    start = time.perf_counter()
    try:
        result = await _run_transcribe(
            instance["model"],
            audio_path,
            chunk_duration=chunk_duration,
            overlap_duration=overlap_duration,
            decoding_config=decoding_config,
            language=language,
        )
        transcript, payload_segments = _parse_result(result)
    finally:
        try:
            os.remove(audio_path)
        except OSError:
            ctx.logger.warning("Failed to clean up temp audio file: %s", audio_path)

    ctx.logger.info(
        "parakeet_mlx.run.output",
        extra={**run_meta, "text": transcript, "segments": len(payload_segments), "text_chars": len(transcript)},
    )

    if req.stream:
        async def generator() -> AsyncIterator[dict]:
            for segment in payload_segments:
                if segment["text"]:
                    yield {"event": "transcript.text.delta", "data": {"text": segment["text"], "start": segment["start"], "end": segment["end"]}}
            yield {"event": "transcript.text.done", "data": {"text": transcript}}

        async def tracked() -> AsyncIterator[dict]:
            try:
                async for item in generator():
                    yield item
            finally:
                duration_ms = round((time.perf_counter() - start) * 1000, 2)
                ctx.logger.info(
                    "parakeet_mlx.run.complete",
                    extra={**run_meta, "duration_ms": duration_ms, "segments": len(payload_segments)},
                )

        return tracked()

    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    ctx.logger.info(
        "parakeet_mlx.run.complete",
        extra={**run_meta, "duration_ms": duration_ms, "segments": len(payload_segments), "text_chars": len(transcript)},
    )
    return {"text": transcript, "segments": payload_segments}
