from __future__ import annotations

from local_runtime.helpers.responses_helpers import build_response, build_stream_events
from local_runtime.types import RunRequest, RunContext

SPEC = {
    "id": "local/llm/qwen3-hf",
    "kind": "llm",
    "display": {
        "title": "Qwen3 Hugging Face",
        "description": "Qwen3 via Hugging Face Transformers.",
        "tags": ["llm", "hf"],
        "icon": "qwen",
    },
    "compat": {
        "platforms": ["darwin-arm64", "darwin-x64", "windows-x64", "linux-x64"],
        "acceleration": ["cuda", "cpu"],
        "priority": 90,
        "requires_ram_gb": 12,
        "requires_vram_gb": 6,
        "disk_gb": 12,
    },
    "api": {
        "endpoint": "responses",
        "advertised_model_name": "qwen3-hf",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 300,
        "concurrency": 1,
        "max_input_mb": 25,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "hf",
        "model_ref": "Qwen/Qwen3",
        "device_hint": "auto",
        "extra": {},
    },
    "execution": {"mode": "subprocess", "warmup_on_start": False},
    "launch": {
        "enabled": True,
        "type": "command",
        "explain": "Launch HF worker subprocess.",
        "env": {},
        "cmd": ["python", "-m", "local_runtime.workers.llm_worker"],
        "ready": {"kind": "log", "timeout_sec": 180, "log_regex": "READY"},
    },
    "ui_params": [],
    "deps": {
        "python_extras": ["hf"],
        "pip": [],
        "system": [],
        "notes": "Torch-based, runs in subprocess.",
    },
}


async def run(req: RunRequest, ctx: RunContext):
    prompt = req.json.get("input", "Hello") if req.json else "Hello"
    text = f"[qwen3-hf] {prompt}"
    if req.stream:
        async def gen():
            for event in build_stream_events(text, SPEC["id"]):
                yield event
        return gen()
    return build_response(text, SPEC["id"])
