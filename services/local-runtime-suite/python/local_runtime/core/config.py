from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, ValidationError

log = logging.getLogger("local-runtime.config")


def _utc_stamp() -> str:
    return datetime.utcnow().strftime("%Y%m%d-%H%M%S")


class RuntimeConfig(BaseModel):
    port: int = 8484
    default_models: dict[str, str] = Field(default_factory=dict)
    data_dir: str = str(Path.home() / ".therapy" / "local-runtime" / "data")
    cache_dir: str = str(Path.home() / ".therapy" / "local-runtime" / "cache")
    prefer_local: bool = True

    @classmethod
    def default_config_path(cls) -> Path:
        return Path.home() / ".therapy" / "local-runtime" / "config.json"

    @classmethod
    def _resolve_path(cls, path: Path | None) -> tuple[Path, bool]:
        raw = ""
        if path is not None:
            raw = str(path)
            candidate = Path(path).expanduser()
        else:
            raw = os.getenv("LOCAL_RUNTIME_CONFIG", "")
            candidate = Path(raw).expanduser() if raw.strip() else cls.default_config_path()

        dir_hint = False
        if raw:
            raw = raw.strip()
            if raw.endswith(("/", "\\")) or raw in {".", ".."}:
                dir_hint = True

        if dir_hint:
            return candidate / "config.json", True

        if candidate.exists() and candidate.is_dir():
            return candidate, False

        return candidate, False

    @classmethod
    def _default_for_path(cls, config_path: Path) -> "RuntimeConfig":
        base_dir = config_path.parent
        return cls(
            data_dir=str(base_dir / "data"),
            cache_dir=str(base_dir / "cache"),
        )

    @classmethod
    def _write_config_file(cls, config_path: Path, config: "RuntimeConfig") -> None:
        config_path.parent.mkdir(parents=True, exist_ok=True)
        payload = config.model_dump()
        config_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    @classmethod
    def _backup_path(cls, config_path: Path, tag: str) -> Path:
        stamp = _utc_stamp()
        return config_path.with_name(f"{config_path.name}.{tag}-{stamp}")

    @classmethod
    def load(cls, path: Path | None = None, *, create: bool = True) -> "RuntimeConfig":
        """
        Load a runtime config safely.

        This function is intentionally defensive:
        - Never raises due to config path/IO/JSON/validation issues.
        - Creates a valid config file if missing (when create=True).
        - Repairs corrupt configs by backing them up and regenerating defaults.
        """
        config_path, dir_intent = cls._resolve_path(path)
        if dir_intent:
            config_path = config_path.expanduser()
        default_config = cls._default_for_path(config_path)

        try:
            config_path.parent.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            log.warning(
                "Config dir unavailable (%s): %s; falling back to default path.",
                config_path,
                exc,
            )
            config_path = cls.default_config_path()
            default_config = cls._default_for_path(config_path)
            try:
                config_path.parent.mkdir(parents=True, exist_ok=True)
            except OSError:
                return default_config

        if config_path.exists() and config_path.is_dir():
            if dir_intent:
                config_path = config_path / "config.json"
                default_config = cls._default_for_path(config_path)
            else:
                try:
                    backup = cls._backup_path(config_path, "dir")
                    config_path.rename(backup)
                    log.warning("Config path was a directory; moved aside to %s", backup)
                except OSError as exc:
                    log.warning(
                        "Config path is a directory and cannot be repaired (%s): %s",
                        config_path,
                        exc,
                    )
                    return default_config

        if not config_path.exists():
            if create:
                try:
                    cls._write_config_file(config_path, default_config)
                except OSError as exc:
                    log.warning("Failed to create config file at %s: %s", config_path, exc)
            return default_config

        if not config_path.is_file():
            if create:
                try:
                    backup = cls._backup_path(config_path, "not-a-file")
                    config_path.rename(backup)
                    cls._write_config_file(config_path, default_config)
                    log.warning("Config path was not a file; moved aside to %s", backup)
                except OSError as exc:
                    log.warning("Failed to repair non-file config path %s: %s", config_path, exc)
            return default_config

        try:
            raw_text = config_path.read_text(encoding="utf-8").strip()
        except OSError as exc:
            log.warning("Failed to read config file %s: %s", config_path, exc)
            return default_config

        try:
            data: dict[str, Any] = json.loads(raw_text or "{}")
        except json.JSONDecodeError as exc:
            if create:
                try:
                    backup = cls._backup_path(config_path, "corrupt")
                    config_path.rename(backup)
                    cls._write_config_file(config_path, default_config)
                    log.warning("Corrupt config JSON; moved aside to %s (%s)", backup, exc)
                except OSError as io_exc:
                    log.warning("Failed to repair corrupt config %s: %s", config_path, io_exc)
            return default_config

        try:
            config = cls.model_validate(data)
        except ValidationError as exc:
            if create:
                try:
                    backup = cls._backup_path(config_path, "invalid")
                    config_path.rename(backup)
                    cls._write_config_file(config_path, default_config)
                    log.warning("Invalid config schema; moved aside to %s (%s)", backup, exc)
                except OSError as io_exc:
                    log.warning("Failed to repair invalid config %s: %s", config_path, io_exc)
            return default_config

        if not str(config.data_dir).strip():
            config.data_dir = default_config.data_dir
        if not str(config.cache_dir).strip():
            config.cache_dir = default_config.cache_dir

        return config

    def ensure_dirs(self) -> None:
        for label, raw_path in (("data_dir", self.data_dir), ("cache_dir", self.cache_dir)):
            try:
                Path(raw_path).expanduser().mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                log.warning("Unable to create %s (%s): %s", label, raw_path, exc)
