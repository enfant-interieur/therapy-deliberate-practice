from __future__ import annotations

import importlib
import pkgutil
from dataclasses import dataclass
from typing import Iterable

from local_runtime.core.errors import ValidationError
from local_runtime.spec import ModelSpec, validate_spec


@dataclass
class LoadedModel:
    name: str
    module: object
    spec: ModelSpec


def iter_model_modules() -> Iterable[str]:
    package = importlib.import_module("local_runtime.models")
    for module_info in pkgutil.iter_modules(package.__path__):
        if module_info.name.startswith("model_") and module_info.name != "model_template":
            yield f"local_runtime.models.{module_info.name}"


def load_models() -> list[LoadedModel]:
    loaded: list[LoadedModel] = []
    for module_name in iter_model_modules():
        module = importlib.import_module(module_name)
        if not hasattr(module, "SPEC"):
            raise ValidationError(f"{module_name} is missing SPEC")
        spec = validate_spec(module.SPEC)
        loaded.append(LoadedModel(name=module_name, module=module, spec=spec))
    return loaded
