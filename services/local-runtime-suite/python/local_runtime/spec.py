from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class DisplaySpec(BaseModel):
    title: str
    description: str
    tags: list[str]
    icon: Optional[str] = None


class CompatSpec(BaseModel):
    platforms: list[str]
    acceleration: list[Literal["metal", "cuda", "cpu"]]
    priority: int
    requires_ram_gb: int
    requires_vram_gb: int
    disk_gb: int


class ApiSpec(BaseModel):
    endpoint: Literal[
        "responses",
        "audio.speech",
        "audio.transcriptions",
        "audio.translations",
    ]
    advertised_model_name: str
    supports_stream: bool


class LimitsSpec(BaseModel):
    timeout_sec: int = 300
    concurrency: int = 1
    max_input_mb: int = 25
    max_output_tokens_default: int = 2048


class BackendSpec(BaseModel):
    provider: Literal[
        "mlx",
        "hf",
        "ollama",
        "kokoro",
        "faster_whisper",
        "openai_proxy",
        "custom",
    ]
    model_ref: str
    revision: Optional[str] = None
    device_hint: Literal["auto", "cpu", "cuda", "metal"] = "auto"
    extra: dict[str, Any] = Field(default_factory=dict)


class ExecutionSpec(BaseModel):
    mode: Literal["inprocess", "subprocess", "http_proxy"]
    warmup_on_start: bool = False


class LaunchReadySpec(BaseModel):
    kind: Literal["http", "log"]
    timeout_sec: int = 180
    http_url: Optional[str] = None
    log_regex: Optional[str] = None


class LaunchSpec(BaseModel):
    enabled: bool
    type: Literal["command", "external"]
    explain: str
    env: dict[str, str]
    cmd: list[str]
    ready: LaunchReadySpec


class UiParamSpec(BaseModel):
    key: str
    type: Literal["string", "number", "boolean", "select"]
    default: Optional[Any] = None
    choices: list[Any] = Field(default_factory=list)
    min: Optional[float] = None
    max: Optional[float] = None


class DepsSpec(BaseModel):
    python_extras: list[str] = Field(default_factory=list)
    pip: list[str] = Field(default_factory=list)
    system: list[str] = Field(default_factory=list)
    notes: str = ""


class ModelSpec(BaseModel):
    id: str
    kind: Literal["llm", "tts", "stt"]
    display: DisplaySpec
    compat: CompatSpec
    api: ApiSpec
    limits: LimitsSpec
    backend: BackendSpec
    execution: ExecutionSpec
    launch: Optional[LaunchSpec] = None
    ui_params: list[UiParamSpec] = Field(default_factory=list)
    deps: DepsSpec = Field(default_factory=DepsSpec)

    @model_validator(mode="after")
    def _validate_launch(self) -> "ModelSpec":
        if self.execution.mode in {"subprocess", "http_proxy"} and self.launch is None:
            raise ValueError("launch is required for subprocess/http_proxy execution")
        return self


__all__ = ["ModelSpec"]
