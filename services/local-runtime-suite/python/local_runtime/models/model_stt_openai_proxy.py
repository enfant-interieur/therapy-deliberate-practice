from __future__ import annotations

import os
from typing import AsyncIterator

from local_runtime.types import RunContext, RunRequest

SPEC = {
    "id": "local//stt/openai-proxy",
    "kind": "stt",
    "display": {
        "title": "OpenAI STT Proxy",
        "description": "Proxy to OpenAI for speech transcription/translation.",
        "tags": ["stt", "proxy", "openai"],
        "icon": "cloud",
    },
    "compat": {
        "platforms": ["darwin-arm64", "darwin-x64", "windows-x64", "linux-x64"],
        "acceleration": ["cpu"],
        "priority": 80,
        "requires_ram_gb": 2,
        "requires_vram_gb": 0,
        "disk_gb": 0,
    },
    "api": {
        "endpoint": "audio.translations",
        "advertised_model_name": "openai-stt",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 300,
        "concurrency": 4,
        "max_input_mb": 25,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "openai_proxy",
        "model_ref": "gpt-4o-mini-transcribe",
        "revision": None,
        "device_hint": "auto",
        "extra": {},
    },
    "execution": {
        "mode": "http_proxy",
        "warmup_on_start": False,
    },
    "launch": {
        "enabled": False,
        "type": "external",
        "explain": "Requires OPENAI_API_KEY and network access.",
        "env": {},
        "cmd": ["echo", "openai"],
        "ready": {
            "kind": "http",
            "timeout_sec": 60,
            "http_url": "http://127.0.0.1:{port}/health",
            "log_regex": "READY",
        },
    },
    "ui_params": [],
    "deps": {
        "python_extras": [],
        "pip": [],
        "system": [],
        "notes": "Uses OpenAI API when enabled.",
    },
}


async def run(req: RunRequest, ctx: RunContext):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required for the OpenAI STT proxy.")
    if not req.files or "file" not in req.files:
        raise ValueError("Missing audio file.")
    file_entry = req.files["file"]
    filename = "audio"
    content_type = "application/octet-stream"
    data = None
    if isinstance(file_entry, dict):
        filename = file_entry.get("filename") or filename
        content_type = file_entry.get("content_type") or content_type
        data = file_entry.get("data")
    else:
        filename = getattr(file_entry, "filename", filename)
        content_type = getattr(file_entry, "content_type", content_type)
        data = getattr(file_entry, "data", None)
    if not isinstance(data, (bytes, bytearray)):
        raise ValueError("Invalid audio payload.")

    response_format = req.form.get("response_format") if req.form else None
    model_name = os.getenv("LOCAL_RUNTIME_STT_MODEL", SPEC["backend"]["model_ref"])
    payload = {"model": model_name}
    if req.form:
        if req.form.get("language"):
            payload["language"] = req.form["language"]
        if req.form.get("prompt"):
            payload["prompt"] = req.form["prompt"]
        if response_format:
            payload["response_format"] = response_format

    response = await ctx.http_client.post(
        "https://api.openai.com/v1/audio/translations",
        headers={"Authorization": f"Bearer {api_key}"},
        data=payload,
        files={"file": (filename, data, content_type)},
    )
    response.raise_for_status()

    if response_format in {"text", "srt", "vtt"}:
        transcript = response.text
    else:
        transcript_payload = response.json()
        transcript = transcript_payload.get("text", "")

    if req.stream:
        async def generator() -> AsyncIterator[dict]:
            for chunk in [transcript[i : i + 30] for i in range(0, len(transcript), 30)]:
                yield {"event": "transcript.text.delta", "data": {"text": chunk}}
            yield {"event": "transcript.text.done", "data": {"text": transcript}}
        return generator()
    return {"text": transcript}
