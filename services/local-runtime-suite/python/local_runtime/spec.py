from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class DisplaySpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    description: str
    tags: list[str]
    icon: str | None = None


class CompatSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platforms: list[Literal["darwin-arm64", "darwin-x64", "windows-x64", "linux-x64"]]
    acceleration: list[Literal["metal", "cuda", "cpu"]]
    priority: int
    requires_ram_gb: int
    requires_vram_gb: int
    disk_gb: int


class ApiSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    endpoint: Literal["responses", "audio.speech", "audio.transcriptions", "audio.translations"]
    advertised_model_name: str
    supports_stream: bool


class LimitsSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timeout_sec: int
    concurrency: int
    max_input_mb: int
    max_output_tokens_default: int


class BackendSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: Literal["mlx", "hf", "ollama", "kokoro", "faster_whisper", "openai_proxy", "custom"]
    model_ref: str
    revision: str | None = None
    device_hint: Literal["auto", "cpu", "cuda", "metal"]
    extra: dict[str, Any] = Field(default_factory=dict)


class ExecutionSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["inprocess", "subprocess", "http_proxy"]
    warmup_on_start: bool


class ReadySpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["http", "log"]
    timeout_sec: int
    http_url: str | None = None
    log_regex: str | None = None


class LaunchSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    type: Literal["command", "external"]
    explain: str
    env: dict[str, str]
    cmd: list[str]
    ready: ReadySpec


class UiParamSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    type: Literal["string", "number", "boolean", "select"]
    default: Any | None = None
    choices: list[Any]
    min: float | None = None
    max: float | None = None


class DepsSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    python_extras: list[str]
    pip: list[str]
    system: list[str]
    notes: str


class ModelSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    kind: Literal["llm", "tts", "stt"]
    display: DisplaySpec
    compat: CompatSpec
    api: ApiSpec
    limits: LimitsSpec
    backend: BackendSpec
    execution: ExecutionSpec
    launch: LaunchSpec
    ui_params: list[UiParamSpec]
    deps: DepsSpec


def validate_spec(raw: dict[str, Any]) -> ModelSpec:
    return ModelSpec.model_validate(raw)
