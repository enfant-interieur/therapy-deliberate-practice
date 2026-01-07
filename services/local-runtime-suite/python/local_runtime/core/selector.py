from __future__ import annotations

import platform as platform_module
from dataclasses import dataclass
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


@dataclass
class SelectionStrategy:
    platform_id: str

    def select(
        self,
        models: Iterable[LoadedModel],
        endpoint: str,
        requested: str | None = None,
    ) -> LoadedModel:
        candidates = [m for m in models if m.spec.api.endpoint == endpoint and is_platform_supported(m.spec, self.platform_id)]
        if requested:
            for model in candidates:
                if model.spec.id == requested or model.spec.api.advertised_model_name == requested:
                    return model
            raise ModelNotFoundError(f"Model '{requested}' not found for endpoint {endpoint}")
        if not candidates:
            raise ModelNotFoundError(f"No models available for endpoint {endpoint}")
        return max(candidates, key=self._score)

    def compute_defaults(self, models_by_endpoint: dict[str, list[LoadedModel]]) -> dict[str, str]:
        defaults: dict[str, str] = {}
        for endpoint, models in models_by_endpoint.items():
            try:
                defaults[endpoint] = self.select(models, endpoint).spec.id
            except ModelNotFoundError:
                continue
        return defaults

    def _score(self, model: LoadedModel) -> float:
        spec = model.spec
        score = float(spec.compat.priority)
        provider = spec.backend.provider
        if self.platform_id == "darwin-arm64" and provider == "mlx":
            score += 25
        elif self.platform_id != "darwin-arm64" and provider == "mlx":
            score -= 20
        if spec.execution.mode == "inprocess":
            score += 5
        if provider in {"hf", "kokoro", "faster_whisper", "ollama", "chatterbox"}:
            score += 2
        return score
