from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Literal

from pydantic import BaseModel

EndpointLiteral = Literal["responses", "audio.speech", "audio.transcriptions", "audio.translations"]


class RunRequest(BaseModel):
    endpoint: EndpointLiteral
    model: str | None = None
    json: dict | None = None
    form: dict | None = None
    files: dict | None = None
    stream: bool | None = None


@dataclass
class RunContext:
    request_id: str
    logger: Any
    data_dir: str
    cache_dir: str
    platform: str
    http_client: Any
    cancellation_token: Any | None = None
    model_state: dict[str, Any] = field(default_factory=dict)


RunResult = (
    dict
    | bytes
    | str
    | AsyncIterator[dict]
    | AsyncIterator[bytes]
)
