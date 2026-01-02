from __future__ import annotations

from local_runtime.types import RunContext, RunRequest

SPEC = {
    "id": "local//template",
    "kind": "llm",
    "display": {
        "title": "Template model",
        "description": "Copy this template to add a new model.",
        "tags": ["template"],
        "icon": "spark",
    },
    "compat": {
        "platforms": ["darwin-arm64", "darwin-x64", "windows-x64", "linux-x64"],
        "acceleration": ["cpu"],
        "priority": 0,
        "requires_ram_gb": 4,
        "requires_vram_gb": 0,
        "disk_gb": 1,
    },
    "api": {
        "endpoint": "responses",
        "advertised_model_name": "template",
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
        "model_ref": "template",
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
        "explain": "No launch needed for the template.",
        "env": {},
        "cmd": ["echo", "template"],
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
        "notes": "Copy and customize this template.",
    },
}


async def run(req: RunRequest, ctx: RunContext):
    raise NotImplementedError("Template model; implement run().")
