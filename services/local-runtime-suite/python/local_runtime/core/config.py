from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from pydantic import BaseModel


class RuntimeConfig(BaseModel):
    port: int = 8484
    default_models: dict[str, str] = {}
    data_dir: str = str(Path.home() / ".therapy" / "local-runtime" / "data")
    cache_dir: str = str(Path.home() / ".therapy" / "local-runtime" / "cache")
    prefer_local: bool = True

    @classmethod
    def load(cls, path: Path | None = None) -> "RuntimeConfig":
        config_path = path or Path(os.getenv("LOCAL_RUNTIME_CONFIG", ""))
        if not config_path:
            config_path = Path.home() / ".therapy" / "local-runtime" / "config.json"
        if not config_path.exists():
            return cls()
        data: dict[str, Any] = json.loads(config_path.read_text())
        return cls.model_validate(data)

    def ensure_dirs(self) -> None:
        Path(self.data_dir).mkdir(parents=True, exist_ok=True)
        Path(self.cache_dir).mkdir(parents=True, exist_ok=True)
