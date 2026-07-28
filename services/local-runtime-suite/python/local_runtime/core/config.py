from __future__ import annotations

import json
import os
import secrets
import tempfile
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, PrivateAttr, field_validator


class RuntimeConfig(BaseModel):
    port: int = 8484
    default_models: dict[str, str] = Field(default_factory=dict)
    data_dir: str = str(Path.home() / ".therapy" / "local-runtime" / "data")
    cache_dir: str = str(Path.home() / ".therapy" / "local-runtime" / "cache")
    prefer_local: bool = True
    access_token: str = ""
    _config_path: Path | None = PrivateAttr(default=None)

    @field_validator("access_token")
    @classmethod
    def validate_access_token(cls, value: str) -> str:
        if value and len(value) < 32:
            raise ValueError("access_token must contain at least 32 characters")
        return value

    @classmethod
    def load(cls, path: Path | None = None) -> RuntimeConfig:
        config_path = cls.resolve_path(path)
        data: dict[str, Any] = {}
        if config_path.exists():
            if not config_path.is_file():
                raise ValueError(f"Runtime config path is not a file: {config_path}")
            data = json.loads(config_path.read_text(encoding="utf-8"))
        config = cls.model_validate(data)
        config._config_path = config_path
        if not config.access_token:
            config.access_token = secrets.token_urlsafe(32)
            config.save()
        return config

    @staticmethod
    def resolve_path(path: Path | None = None) -> Path:
        if path is not None:
            return Path(path).expanduser()
        raw = os.getenv("LOCAL_RUNTIME_CONFIG")
        if raw and raw.strip():
            return Path(raw).expanduser()
        return Path.home() / ".therapy" / "local-runtime" / "config.json"

    def save(self, path: Path | None = None) -> Path:
        config_path = self.resolve_path(path or self._config_path)
        config_dir = config_path.parent
        config_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        if os.name != "nt":
            config_dir.chmod(0o700)

        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=config_dir,
                prefix=f".{config_path.name}.",
                suffix=".tmp",
                delete=False,
            ) as temporary:
                temporary_path = Path(temporary.name)
                json.dump(self.model_dump(), temporary, indent=2, sort_keys=True)
                temporary.write("\n")
                temporary.flush()
                os.fsync(temporary.fileno())
            if os.name != "nt":
                temporary_path.chmod(0o600)
            os.replace(temporary_path, config_path)
            if os.name != "nt":
                config_path.chmod(0o600)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()
        self._config_path = config_path
        return config_path

    def ensure_dirs(self) -> None:
        Path(self.data_dir).mkdir(parents=True, exist_ok=True)
        Path(self.cache_dir).mkdir(parents=True, exist_ok=True)
