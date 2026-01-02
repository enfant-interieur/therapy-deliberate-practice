from __future__ import annotations

from typing import Optional

from local_runtime.core.platform import current_platform
from local_runtime.core.loader import ModelModule


def select_default(
    registry: dict[str, ModelModule], endpoint: str, requested: Optional[str]
) -> ModelModule:
    if requested:
        for mod in registry.values():
            if mod.spec.id == requested or mod.spec.api.advertised_model_name == requested:
                return mod
        raise KeyError(f"model not found: {requested}")
    platform = current_platform()
    candidates = [
        mod
        for mod in registry.values()
        if mod.spec.api.endpoint == endpoint and platform in mod.spec.compat.platforms
    ]
    if not candidates:
        raise KeyError(f"no models available for endpoint {endpoint}")
    candidates.sort(key=lambda mod: mod.spec.compat.priority, reverse=True)
    return candidates[0]
