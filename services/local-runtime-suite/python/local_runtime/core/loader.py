from __future__ import annotations

import argparse
import importlib
import pkgutil
from typing import Any

from local_runtime.spec import ModelSpec


class ModelModule:
    def __init__(self, name: str, spec: ModelSpec, module: Any):
        self.name = name
        self.spec = spec
        self.module = module


def discover_modules() -> list[ModelModule]:
    modules: list[ModelModule] = []
    package = "local_runtime.models"
    for info in pkgutil.iter_modules(importlib.import_module(package).__path__):
        if not info.name.startswith("model_"):
            continue
        module = importlib.import_module(f"{package}.{info.name}")
        spec_dict = getattr(module, "SPEC", None)
        if spec_dict is None:
            raise ValueError(f"{info.name} missing SPEC")
        spec = ModelSpec.model_validate(spec_dict)
        modules.append(ModelModule(info.name, spec, module))
    return modules


def build_registry() -> dict[str, ModelModule]:
    registry: dict[str, ModelModule] = {}
    for mod in discover_modules():
        registry[mod.spec.id] = mod
    return registry


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate", action="store_true")
    args = parser.parse_args()
    if args.validate:
        models = discover_modules()
        print(f"validated {len(models)} model specs")


if __name__ == "__main__":
    main()
