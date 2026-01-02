from __future__ import annotations

from dataclasses import dataclass
from typing import Any, AsyncIterator, Literal, Optional

from pydantic import BaseModel, ConfigDict


class RunRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    endpoint: Literal["responses", "audio.speech", "audio.transcriptions", "audio.translations"]
    model: Optional[str] = None
    json: Optional[dict[str, Any]] = None
    form: Optional[dict[str, Any]] = None
    files: Optional[dict[str, Any]] = None
    stream: Optional[bool] = None


@dataclass
class RunContext:
    request_id: str
    logger: Any
    data_dir: str
    cache_dir: str
    platform: str
    http_client: Any
    cancel_token: Any
    state: dict[str, Any]


RunResult = Any
