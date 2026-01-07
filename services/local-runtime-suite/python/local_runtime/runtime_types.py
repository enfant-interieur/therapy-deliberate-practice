from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, AsyncIterator, Literal

from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from local_runtime.core.registry import ModelRegistry

EndpointLiteral = Literal["responses", "audio.speech", "audio.transcriptions", "audio.translations"]


class RunRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    endpoint: EndpointLiteral
    model: str | None = None
    payload: dict | None = Field(default=None, alias="json")
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
    registry: ModelRegistry
    http_client: Any
    cancellation_token: Any | None = None


RunResult = (
    dict
    | bytes
    | str
    | AsyncIterator[dict]
    | AsyncIterator[bytes]
)
