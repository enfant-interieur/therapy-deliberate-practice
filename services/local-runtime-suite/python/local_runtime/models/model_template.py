from __future__ import annotations

from local_runtime.types import RunRequest, RunContext

SPEC = {
    "id": "local/llm/example",
    "kind": "llm",
    "display": {
        "title": "Example Model",
        "description": "Template model spec.",
        "tags": ["template"],
        "icon": "template",
    },
    "compat": {
        "platforms": ["darwin-arm64", "darwin-x64", "windows-x64", "linux-x64"],
        "acceleration": ["cpu"],
        "priority": 0,
        "requires_ram_gb": 1,
        "requires_vram_gb": 0,
        "disk_gb": 0,
    },
    "api": {
        "endpoint": "responses",
        "advertised_model_name": "example",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 300,
        "concurrency": 1,
        "max_input_mb": 25,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "custom",
        "model_ref": "example",
        "device_hint": "cpu",
        "extra": {},
    },
    "execution": {
        "mode": "inprocess",
        "warmup_on_start": False,
    },
    "launch": None,
    "ui_params": [],
    "deps": {
        "python_extras": [],
        "pip": [],
        "system": [],
        "notes": "",
    },
}


async def run(req: RunRequest, ctx: RunContext):
    raise NotImplementedError("Implement model run()")
