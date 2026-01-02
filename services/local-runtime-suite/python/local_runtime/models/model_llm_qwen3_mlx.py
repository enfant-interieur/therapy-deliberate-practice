from __future__ import annotations

from local_runtime.helpers.responses_helpers import build_response, build_stream_events
from local_runtime.types import RunRequest, RunContext

SPEC = {
    "id": "local/llm/qwen3-mlx",
    "kind": "llm",
    "display": {
        "title": "Qwen3 MLX",
        "description": "Qwen3 running via MLX.",
        "tags": ["llm", "mlx"],
        "icon": "qwen",
    },
    "compat": {
        "platforms": ["darwin-arm64", "darwin-x64"],
        "acceleration": ["metal", "cpu"],
        "priority": 100,
        "requires_ram_gb": 8,
        "requires_vram_gb": 0,
        "disk_gb": 8,
    },
    "api": {
        "endpoint": "responses",
        "advertised_model_name": "qwen3-mlx",
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
        "model_ref": "Qwen/Qwen3",
        "device_hint": "metal",
        "extra": {},
    },
    "execution": {"mode": "inprocess", "warmup_on_start": False},
    "launch": None,
    "ui_params": [],
    "deps": {
        "python_extras": ["mlx"],
        "pip": [],
        "system": [],
        "notes": "Requires MLX on Apple Silicon.",
    },
}


async def run(req: RunRequest, ctx: RunContext):
    prompt = req.json.get("input", "Hello") if req.json else "Hello"
    text = f"[qwen3-mlx] {prompt}"
    if req.stream:
        async def gen():
            for event in build_stream_events(text, SPEC["id"]):
                yield event
        return gen()
    return build_response(text, SPEC["id"])
