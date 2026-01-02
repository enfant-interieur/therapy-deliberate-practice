from __future__ import annotations

from fastapi import APIRouter, Request

from local_runtime.core.platform import current_platform

router = APIRouter()


@router.get("/health")
async def health(request: Request) -> dict:
    registry = request.app.state.registry
    supervisor = request.app.state.supervisor
    defaults = {
        "llm": None,
        "tts": None,
        "stt": None,
    }
    for mod in registry.values():
        if mod.spec.kind == "llm" and defaults["llm"] is None:
            defaults["llm"] = mod.spec.id
        if mod.spec.kind == "tts" and defaults["tts"] is None:
            defaults["tts"] = mod.spec.id
        if mod.spec.kind == "stt" and defaults["stt"] is None:
            defaults["stt"] = mod.spec.id
    return {
        "status": "ready",
        "platform": current_platform(),
        "defaults": defaults,
        "workers": [worker.__dict__ for worker in supervisor.status()],
        "last_error": None,
    }
