from __future__ import annotations

import platform as platform_module
from typing import Iterable

from local_runtime.core.errors import ModelNotFoundError
from local_runtime.core.loader import LoadedModel
from local_runtime.spec import ModelSpec


def detect_platform() -> str:
    system = platform_module.system().lower()
    machine = platform_module.machine().lower()
    if system == "darwin":
        arch = "arm64" if machine in {"arm64", "aarch64"} else "x64"
        return f"darwin-{arch}"
    if system == "windows":
        return "windows-x64"
    return "linux-x64"


def is_platform_supported(spec: ModelSpec, platform_id: str) -> bool:
    return platform_id in spec.compat.platforms


def select_model(
    models: Iterable[LoadedModel],
    endpoint: str,
    requested: str | None,
    platform_id: str,
) -> LoadedModel:
    candidates = [m for m in models if m.spec.api.endpoint == endpoint and is_platform_supported(m.spec, platform_id)]
    if requested:
        for model in candidates:
            if model.spec.id == requested or model.spec.api.advertised_model_name == requested:
                return model
        raise ModelNotFoundError(f"Model '{requested}' not found for endpoint {endpoint}")
    if not candidates:
        raise ModelNotFoundError(f"No models available for endpoint {endpoint}")
    return sorted(candidates, key=lambda m: m.spec.compat.priority, reverse=True)[0]
