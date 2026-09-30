#!/usr/bin/env python3
from __future__ import annotations

import json
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PYTHON_ROOT = ROOT / "services" / "local-runtime-suite" / "python"
WEB_PUBLIC = ROOT / "apps" / "web" / "public" / "local-suite"

sys.path.insert(0, str(PYTHON_ROOT))

from local_runtime.core.loader import load_models


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the executable model catalog")
    parser.add_argument("--output", type=Path, default=WEB_PUBLIC / "models.json")
    args = parser.parse_args()
    models = load_models()
    output = []
    for model in models:
        output.append(model.spec.model_dump())
    path = args.output
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps({'models': output}, indent=2)}\n")
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
