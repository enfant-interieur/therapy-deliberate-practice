from __future__ import annotations

from dataclasses import dataclass
import os


@dataclass
class RuntimeConfig:
    port: int = 8000
    data_dir: str = os.path.expanduser("~/.local-runtime/data")
    cache_dir: str = os.path.expanduser("~/.local-runtime/cache")
    prefer_proxy: bool = False


def load_config() -> RuntimeConfig:
    return RuntimeConfig(
        port=int(os.getenv("LOCAL_RUNTIME_PORT", "8000")),
        data_dir=os.getenv("LOCAL_RUNTIME_DATA_DIR", RuntimeConfig.data_dir),
        cache_dir=os.getenv("LOCAL_RUNTIME_CACHE_DIR", RuntimeConfig.cache_dir),
        prefer_proxy=os.getenv("LOCAL_RUNTIME_PREFER_PROXY", "false").lower() == "true",
    )
