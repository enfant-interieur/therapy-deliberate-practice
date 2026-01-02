from __future__ import annotations

from fastapi import FastAPI

from local_runtime.core.loader import build_registry
from local_runtime.core.logging import get_logger
from local_runtime.core.supervisor import Supervisor
from local_runtime.core.config import load_config
from local_runtime.api import (
    responses,
    audio_speech,
    audio_transcriptions,
    audio_translations,
    health,
    models_list,
)


def create_app() -> FastAPI:
    app = FastAPI()
    app.state.logger = get_logger("local_runtime")
    app.state.registry = build_registry()
    app.state.supervisor = Supervisor()
    app.state.config = load_config()

    app.include_router(health.router)
    app.include_router(models_list.router)
    app.include_router(responses.router)
    app.include_router(audio_speech.router)
    app.include_router(audio_transcriptions.router)
    app.include_router(audio_translations.router)
    return app
