from __future__ import annotations

import asyncio
import audioop
import io
import os
import shutil
import tempfile
import threading
import time
import wave
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from local_runtime.cancellation import CancellationToken, acquire_model_lock
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
        "revision": "ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15",
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
        "pip": ["parakeet-mlx==0.5.2", "imageio-ffmpeg==0.6.0"],
        "system": [],
        "notes": "Includes a platform-specific FFmpeg binary for reliable audio decoding.",
    },
}

DEFAULT_CHUNK_SECONDS = float(os.getenv("LOCAL_RUNTIME_STT_CHUNK_SEC", "120"))
DEFAULT_OVERLAP_SECONDS = float(os.getenv("LOCAL_RUNTIME_STT_OVERLAP_SEC", "15"))
BOOST_MIN_RMS = float(os.getenv("LOCAL_RUNTIME_STT_BOOST_MIN_RMS", "400"))
BOOST_TARGET_RMS = float(os.getenv("LOCAL_RUNTIME_STT_BOOST_TARGET_RMS", "2500"))
BOOST_MAX_GAIN = float(os.getenv("LOCAL_RUNTIME_STT_BOOST_MAX_GAIN", "8.0"))
_FFMPEG_PATH_LOCK = threading.Lock()


def _resolve_model_path(model_name: str, revision: str, cache_dir: str) -> str:
    local_path = Path(model_name).expanduser()
    if local_path.exists():
        return str(local_path.resolve())

    from huggingface_hub import snapshot_download

    return snapshot_download(
        repo_id=model_name,
        revision=revision,
        cache_dir=cache_dir,
        allow_patterns=["config.json", "model.safetensors"],
    )


def _ensure_ffmpeg_available(cache_dir: str) -> str:
    existing = shutil.which("ffmpeg")
    if existing:
        return existing

    try:
        import imageio_ffmpeg  # type: ignore
    except ImportError as exc:
        raise RuntimeError("Parakeet MLX requires the packaged imageio-ffmpeg audio decoder.") from exc

    bundled_executable = Path(imageio_ffmpeg.get_ffmpeg_exe()).resolve()
    if not bundled_executable.is_file():
        raise RuntimeError("The packaged FFmpeg audio decoder could not be located.")

    with _FFMPEG_PATH_LOCK:
        existing = shutil.which("ffmpeg")
        if existing:
            return existing

        shim_dir = Path(cache_dir) / "parakeet-ffmpeg"
        shim_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        shim_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
        shim_path = shim_dir / shim_name
        source_size = bundled_executable.stat().st_size
        shim_is_current = (
            shim_path.is_file() and not shim_path.is_symlink() and shim_path.stat().st_size == source_size
        )
        if not shim_is_current:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                prefix=f".{shim_name}-",
                dir=shim_dir,
                delete=False,
            ) as temporary:
                temporary_path = Path(temporary.name)
                with bundled_executable.open("rb") as source:
                    shutil.copyfileobj(source, temporary)
            try:
                temporary_path.chmod(0o700)
                os.replace(temporary_path, shim_path)
            finally:
                temporary_path.unlink(missing_ok=True)

        path_entries = os.environ.get("PATH", "").split(os.pathsep)
        if str(shim_dir) not in path_entries:
            os.environ["PATH"] = os.pathsep.join([str(shim_dir), *path_entries])
        resolved = shutil.which("ffmpeg")
        if not resolved:
            raise RuntimeError("The packaged FFmpeg audio decoder could not be activated.")
        return resolved


def load(ctx: RunContext) -> dict[str, Any]:
    try:
        from parakeet_mlx import from_pretrained  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "parakeet-mlx is required for MLX transcription. Install with `pip install parakeet-mlx`."
        ) from exc
    model_name = os.getenv("LOCAL_RUNTIME_STT_MODEL", SPEC["backend"]["model_ref"])
    revision = os.getenv("LOCAL_RUNTIME_STT_REVISION") or SPEC["backend"]["revision"]
    ffmpeg_path = _ensure_ffmpeg_available(ctx.cache_dir)
    model_path = _resolve_model_path(model_name, revision, ctx.cache_dir)
    ctx.logger.info(
        "parakeet_mlx.load",
        extra={"model_id": SPEC["id"], "model_ref": model_name, "revision": revision},
    )
    model = from_pretrained(model_path)

    if os.getenv("LOCAL_RUNTIME_STT_LOCAL_ATTENTION", "0").lower() in {"1", "true", "yes"}:
        encoder = getattr(model, "encoder", None)
        if encoder and hasattr(encoder, "set_attention_model"):
            encoder.set_attention_model("rel_pos_local_attn", (256, 256))

    return {
        "model": model,
        "model_ref": model_name,
        "revision": revision,
        "lock": threading.Lock(),
        "ffmpeg_path": ffmpeg_path,
    }


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
        raise TypeError("Invalid audio payload.")
    return UploadedFile(filename=filename, content_type=content_type, data=bytes(data))


def _maybe_boost_wav(upload: UploadedFile, ctx: RunContext) -> tuple[UploadedFile, dict[str, float] | None]:
    """Boost unusually quiet uncompressed WAV input before transcription."""
    content_type = (upload.content_type or "").lower()
    filename = (upload.filename or "").lower()
    if "wav" not in content_type and not filename.endswith(".wav"):
        return upload, None
    try:
        buffer = io.BytesIO(upload.data)
        with wave.open(buffer, "rb") as reader:
            params = reader.getparams()
            if params.sampwidth not in (1, 2, 4):
                return upload, None
            if params.comptype not in {"NONE", "NONE\x00"}:
                return upload, None
            frames = reader.readframes(params.nframes)
    except (wave.Error, OSError):
        return upload, None
    if not frames:
        return upload, None
    try:
        rms = float(audioop.rms(frames, params.sampwidth))
        peak = float(audioop.max(frames, params.sampwidth))
    except audioop.error:
        return upload, None
    if rms >= BOOST_MIN_RMS or BOOST_MIN_RMS <= 0:
        return upload, None
    gain = min(BOOST_MAX_GAIN, BOOST_TARGET_RMS / max(rms, 1.0))
    if gain <= 1.01:
        return upload, None
    try:
        boosted_frames = audioop.mul(frames, params.sampwidth, gain)
    except audioop.error:
        return upload, None
    out_buffer = io.BytesIO()
    with wave.open(out_buffer, "wb") as writer:
        writer.setnchannels(params.nchannels)
        writer.setsampwidth(params.sampwidth)
        writer.setframerate(params.framerate)
        writer.writeframes(boosted_frames)
    boosted = UploadedFile(
        filename=upload.filename,
        content_type=upload.content_type,
        data=out_buffer.getvalue(),
    )
    ctx.logger.info(
        "parakeet_mlx.audio.boost",
        extra={
            "model_id": SPEC["id"],
            "rms": round(rms, 2),
            "peak": round(peak, 2),
            "gain": round(gain, 2),
        },
    )
    return boosted, {"rms": rms, "peak": peak, "gain": gain}


def _write_temp_audio(upload: UploadedFile, cache_dir: str) -> str:
    os.makedirs(cache_dir, exist_ok=True)
    suffix = os.path.splitext(upload.filename or "")[1].lower()
    if not suffix or len(suffix) > 8 or not suffix[1:].isalnum():
        suffix = ".audio"
    with tempfile.NamedTemporaryFile(
        mode="wb",
        suffix=suffix,
        prefix="parakeet-mlx-",
        dir=cache_dir,
        delete=False,
    ) as handle:
        handle.write(upload.data)
        return handle.name


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


def _build_transcribe_kwargs(
    chunk_duration: float, overlap_duration: float, decoding_config
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "chunk_duration": chunk_duration,
        "overlap_duration": overlap_duration,
    }
    if decoding_config:
        kwargs["decoding_config"] = decoding_config
    return kwargs


async def _run_transcribe(
    instance: dict[str, Any],
    audio_path: str,
    chunk_duration: float,
    overlap_duration: float,
    decoding_config,
    token: CancellationToken | None = None,
) -> Any:
    kwargs = _build_transcribe_kwargs(chunk_duration, overlap_duration, decoding_config)

    def _invoke():
        if token is not None:
            token.raise_if_cancelled()
        with acquire_model_lock(instance["lock"], token):
            result = instance["model"].transcribe(audio_path, **kwargs)
        if token is not None:
            token.raise_if_cancelled()
        return result

    return await asyncio.to_thread(_invoke)


def _normalise_transcribe_window(
    chunk_duration: Any,
    overlap_duration: Any,
) -> tuple[float, float]:
    try:
        chunk = float(chunk_duration)
    except (TypeError, ValueError):
        chunk = DEFAULT_CHUNK_SECONDS
    try:
        overlap = float(overlap_duration)
    except (TypeError, ValueError):
        overlap = DEFAULT_OVERLAP_SECONDS
    chunk = max(10.0, min(chunk, 600.0))
    overlap = max(0.0, min(overlap, min(60.0, chunk / 2)))
    return chunk, overlap


def _parse_result(result) -> tuple[str, list[dict]]:
    text = ""
    segments: list[dict] = []
    if hasattr(result, "text"):
        text = str(getattr(result, "text", "") or "")
    if hasattr(result, "sentences"):
        for idx, sentence in enumerate(result.sentences or []):
            segment_text = str(getattr(sentence, "text", "") or "").strip()
            start = float(getattr(sentence, "start", 0.0))
            end = float(getattr(sentence, "end", start))
            if segment_text:
                segments.append({"id": idx, "start": start, "end": end, "text": segment_text})
    if not text and segments:
        text = " ".join(segment["text"] for segment in segments).strip()
    return text, segments


async def run(req: RunRequest, ctx: RunContext):
    model_id = req.model or SPEC["id"]
    instance = await ctx.registry.ensure_instance(model_id, ctx)
    if not instance:
        raise RuntimeError("Parakeet MLX model is not initialized.")
    upload = _extract_upload(req)
    normalized_upload, boost_meta = _maybe_boost_wav(upload, ctx)
    audio_path = _write_temp_audio(normalized_upload, ctx.cache_dir)

    form_data = req.form or {}
    decoding_config = _build_decoding_config()
    chunk_duration, overlap_duration = _normalise_transcribe_window(
        form_data.get("chunk_duration", DEFAULT_CHUNK_SECONDS),
        form_data.get("overlap_duration", DEFAULT_OVERLAP_SECONDS),
    )
    run_meta = {
        "model_id": model_id,
        "stream": bool(req.stream),
        "input_bytes": len(normalized_upload.data),
        "chunk_duration": chunk_duration,
        "overlap_duration": overlap_duration,
    }
    language = form_data.get("language")
    if language:
        run_meta["language"] = language
    if boost_meta:
        run_meta.update(
            {
                "audio_boost": True,
                "audio_boost_gain": round(boost_meta["gain"], 2),
                "audio_boost_rms": round(boost_meta["rms"], 2),
            }
        )
    ctx.logger.info("parakeet_mlx.run.start", extra=run_meta)
    start = time.perf_counter()
    try:
        result = await _run_transcribe(
            instance,
            audio_path,
            chunk_duration=chunk_duration,
            overlap_duration=overlap_duration,
            decoding_config=decoding_config,
            token=ctx.cancellation_token,
        )
        transcript, payload_segments = _parse_result(result)
    finally:
        try:
            os.remove(audio_path)
        except OSError:
            ctx.logger.warning(
                "parakeet_mlx.temp_cleanup_failed",
                extra={"model_id": model_id},
            )

    ctx.logger.info(
        "parakeet_mlx.run.output",
        extra={
            **run_meta,
            "segments": len(payload_segments),
            "text_chars": len(transcript),
        },
    )

    if req.stream:

        async def generator() -> AsyncIterator[dict]:
            for segment in payload_segments:
                if segment["text"]:
                    yield {
                        "event": "transcript.text.delta",
                        "data": {"text": segment["text"], "start": segment["start"], "end": segment["end"]},
                    }
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
        extra={
            **run_meta,
            "duration_ms": duration_ms,
            "segments": len(payload_segments),
            "text_chars": len(transcript),
        },
    )
    return {"text": transcript, "segments": payload_segments}
