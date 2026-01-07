from __future__ import annotations

import asyncio
import inspect
import io
import time
from typing import Any, AsyncIterator

import numpy as np
import soundfile as sf

from local_runtime.runtime_types import RunContext, RunRequest

SPEC = {
    "id": "local//tts/chatterbox",
    "kind": "tts",
    "display": {
        "title": "Chatterbox TTS",
        "description": "Resemble AI's Chatterbox voices with CFG/exaggeration control.",
        "tags": ["tts", "chatterbox", "multilingual"],
        "icon": "waveform",
    },
    "compat": {
        "platforms": ["darwin-arm64", "darwin-x64", "windows-x64", "linux-x64"],
        "acceleration": ["cpu", "cuda"],
        "priority": 130,
        "requires_ram_gb": 8,
        "requires_vram_gb": 0,
        "disk_gb": 10,
    },
    "api": {
        "endpoint": "audio.speech",
        "advertised_model_name": "chatterbox",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 420,
        "concurrency": 1,
        "max_input_mb": 10,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "chatterbox",
        "model_ref": "ResembleAI/chatterbox",
        "revision": None,
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
        "explain": "Runs in-process via Chatterbox TTS.",
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
        {"key": "language", "type": "string", "default": "en", "choices": [], "min": None, "max": None},
        {"key": "cfg_weight", "type": "number", "default": 0.5, "choices": [], "min": -5.0, "max": 5.0},
        {"key": "exaggeration", "type": "number", "default": 0.0, "choices": [], "min": -5.0, "max": 5.0},
    ],
    "deps": {
        "python_extras": ["tts"],
        "pip": ["chatterbox-tts", "torch", "torchaudio", "soundfile"],
        "system": ["ffmpeg optional"],
        "notes": "Install chatterbox-tts for ResembleAI voices.",
    },
}

LANGUAGE_ALIASES = {
    "en": "en",
    "english": "en",
    "fr": "fr",
    "french": "fr",
    "es": "es",
    "spanish": "es",
    "de": "de",
    "german": "de",
    "pt": "pt",
    "portuguese": "pt",
    "it": "it",
    "italian": "it",
    "ja": "ja",
    "japanese": "ja",
    "zh": "zh",
    "chinese": "zh",
}
DEFAULT_LANGUAGE = "en"
DEFAULT_CFG = 0.5
DEFAULT_EXAGGERATION = 0.0


def _extract_text(payload: dict[str, Any] | None) -> str:
    if not payload:
        return ""
    if isinstance(payload.get("input"), str):
        return payload["input"]
    if isinstance(payload.get("input"), list):
        for entry in payload["input"]:
            if isinstance(entry, str):
                return entry
            if isinstance(entry, dict):
                if entry.get("type") == "input_text" and "text" in entry:
                    return str(entry["text"])
                if isinstance(entry.get("content"), list):
                    for chunk in entry["content"]:
                        if isinstance(chunk, dict) and chunk.get("type") == "input_text":
                            return str(chunk.get("text", ""))
    if "text" in payload and isinstance(payload["text"], str):
        return payload["text"]
    return ""


def _resolve_language(value: Any) -> str:
    if not value:
        return DEFAULT_LANGUAGE
    key = str(value).strip().lower()
    return LANGUAGE_ALIASES.get(key, DEFAULT_LANGUAGE)


def _select_device(torch_module) -> str:
    if torch_module.cuda.is_available():
        return "cuda"
    mps_backend = getattr(torch_module.backends, "mps", None)
    if mps_backend and torch_module.backends.mps.is_available():
        return "mps"
    return "cpu"


def load(ctx: RunContext) -> dict[str, Any]:
    try:
        import torch  # type: ignore
        import torchaudio  # noqa: F401  # type: ignore
        from chatterbox.tts import ChatterboxTTS  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "Chatterbox TTS requires 'chatterbox-tts', 'torch', and 'torchaudio'. Install them to enable speech synthesis."
        ) from exc

    device = _select_device(torch)
    ctx.logger.info("chatterbox.load.start", extra={"model_id": SPEC["id"], "device": device})
    original_torch_load = torch.load
    map_location = torch.device(device)

    def patched_torch_load(*args, **kwargs):
        if "map_location" not in kwargs:
            kwargs["map_location"] = map_location
        return original_torch_load(*args, **kwargs)

    torch.load = patched_torch_load
    model = ChatterboxTTS.from_pretrained(device=device)
    signature = inspect.signature(model.generate)
    supported_args = set(signature.parameters.keys())
    ctx.logger.info("chatterbox.load.ready", extra={"model_id": SPEC["id"], "device": device, "supported": sorted(supported_args)})
    return {
        "model": model,
        "device": device,
        "torch": torch,
        "torch_load_orig": original_torch_load,
        "supported_args": supported_args,
    }


def shutdown(instance: dict[str, Any], ctx: RunContext) -> None:
    torch_module = instance.get("torch")
    original = instance.get("torch_load_orig")
    if torch_module and original:
        torch_module.load = original  # type: ignore[assignment]


def warmup(instance: dict[str, Any], ctx: RunContext) -> None:
    ctx.logger.info("chatterbox.warmup.start", extra={"model_id": SPEC["id"]})
    start = time.perf_counter()
    try:
        _synthesize_blocking(
            instance,
            text="Warmup: quick audio ping.",
            language=DEFAULT_LANGUAGE,
            cfg_weight=DEFAULT_CFG,
            exaggeration=DEFAULT_EXAGGERATION,
            audio_prompt=None,
        )
    except Exception as exc:
        ctx.logger.exception("chatterbox.warmup.error", extra={"model_id": SPEC["id"], "error": str(exc)})
        return
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    ctx.logger.info("chatterbox.warmup.done", extra={"model_id": SPEC["id"], "duration_ms": duration_ms})


def _to_numpy_audio(tensor) -> np.ndarray:
    array = tensor.detach().cpu()
    if array.dim() == 1:
        return array.numpy()
    if array.dim() == 2:
        # torchaudio uses (channels, time); soundfile expects (time, channels)
        array = array.transpose(0, 1)
        return array.numpy()
    raise ValueError("Unexpected audio tensor rank.")


def _synthesize_blocking(
    instance: dict[str, Any],
    text: str,
    language: str,
    cfg_weight: float,
    exaggeration: float,
    audio_prompt: str | None,
) -> bytes:
    model = instance["model"]
    supported_args: set[str] = instance.get("supported_args", set())
    kwargs: dict[str, Any] = {}
    if "cfg_weight" in supported_args:
        kwargs["cfg_weight"] = cfg_weight
    if "exaggeration" in supported_args:
        kwargs["exaggeration"] = exaggeration
    if audio_prompt and "audio_prompt_path" in supported_args:
        kwargs["audio_prompt_path"] = audio_prompt
    if language and "language_id" in supported_args:
        kwargs["language_id"] = language

    waveform = model.generate(text, **kwargs)
    buffer = io.BytesIO()
    audio = _to_numpy_audio(waveform)
    sf.write(buffer, audio, model.sr, format="WAV")
    return buffer.getvalue()


async def _synthesize_async(
    instance: dict[str, Any],
    text: str,
    language: str,
    cfg_weight: float,
    exaggeration: float,
    audio_prompt: str | None,
) -> bytes:
    return await asyncio.to_thread(
        _synthesize_blocking,
        instance,
        text,
        language,
        cfg_weight,
        exaggeration,
        audio_prompt,
    )


async def run(req: RunRequest, ctx: RunContext):
    payload = req.payload or {}
    text = _extract_text(payload)
    if not text:
        raise ValueError("Input text is required for speech synthesis.")
    model_id = req.model or SPEC["id"]
    instance = await ctx.registry.ensure_instance(model_id, ctx)
    if not instance:
        raise RuntimeError("Chatterbox TTS model is not initialized.")

    language = _resolve_language(payload.get("language") or payload.get("language_id"))
    cfg_weight = float(payload.get("cfg_weight", DEFAULT_CFG))
    exaggeration = float(payload.get("exaggeration", DEFAULT_EXAGGERATION))
    audio_prompt_path = payload.get("audio_prompt_path")
    supported_args: set[str] = instance.get("supported_args", set())
    if language and "language_id" not in supported_args:
        ctx.logger.warning(
            "chatterbox.language.unsupported",
            extra={"model_id": model_id, "language": language},
        )

    run_meta = {
        "model_id": model_id,
        "language": language,
        "stream": bool(req.stream),
        "audio_prompt": bool(audio_prompt_path),
        "cfg_weight": cfg_weight,
        "exaggeration": exaggeration,
        "text_chars": len(text),
    }
    ctx.logger.info("chatterbox.run.start", extra=run_meta)
    ctx.logger.info("chatterbox.run.input", extra={**run_meta, "text": text})
    start = time.perf_counter()
    try:
        audio_bytes = await _synthesize_async(
            instance,
            text=text,
            language=language,
            cfg_weight=cfg_weight,
            exaggeration=exaggeration,
            audio_prompt=audio_prompt_path,
        )
    except Exception as exc:
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        ctx.logger.exception("chatterbox.run.error", extra={**run_meta, "duration_ms": duration_ms, "error": str(exc)})
        raise

    ctx.logger.info("chatterbox.run.output", extra={**run_meta, "bytes": len(audio_bytes)})
    if req.stream:
        async def generator() -> AsyncIterator[bytes]:
            chunk = 8192
            for idx in range(0, len(audio_bytes), chunk):
                yield audio_bytes[idx : idx + chunk]

        async def tracked() -> AsyncIterator[bytes]:
            try:
                async for chunk_bytes in generator():
                    yield chunk_bytes
            finally:
                duration_ms = round((time.perf_counter() - start) * 1000, 2)
                ctx.logger.info("chatterbox.run.complete", extra={**run_meta, "duration_ms": duration_ms})

        return tracked()

    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    ctx.logger.info("chatterbox.run.complete", extra={**run_meta, "duration_ms": duration_ms, "bytes": len(audio_bytes)})
    return audio_bytes
