from __future__ import annotations

from typing import AsyncIterator

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


def load(ctx: RunContext) -> dict:
    """Preload hook used by the registry."""
    ctx.logger.info("parakeet_mlx.load", extra={"model_id": SPEC["id"]})
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
    prompt_hint = f" prompt={prompt}" if prompt else ""
    lang_hint = f" language={language}" if language else ""
    text = f"[{SPEC['display']['title']}] {upload.filename or 'audio'} ({len(upload.data)} bytes){lang_hint}{prompt_hint}".strip()
    segment = {"id": 0, "start": 0.0, "end": 0.5, "text": text}
    return text, [segment]


async def run(req: RunRequest, ctx: RunContext):
    model_id = req.model or SPEC["id"]
    await ctx.registry.ensure_instance(model_id, ctx)
    upload = _extract_upload(req)
    language = req.form.get("language") if req.form else None
    prompt = req.form.get("prompt") if req.form else None
    transcript, payload_segments = _fake_transcription(upload, language, prompt)

    if req.stream:
        async def generator() -> AsyncIterator[dict]:
            for segment in payload_segments:
                if segment["text"]:
                    yield {"event": "transcript.text.delta", "data": {"text": segment["text"]}}
            yield {"event": "transcript.text.done", "data": {"text": transcript}}
        return generator()

    return {"text": transcript, "segments": payload_segments}
