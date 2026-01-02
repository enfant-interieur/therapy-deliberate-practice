#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PYTHON_ROOT = ROOT / "services" / "local-runtime-suite" / "python"
WEB_PUBLIC = ROOT / "apps" / "web" / "public" / "local-suite"

sys.path.insert(0, str(PYTHON_ROOT))

from local_runtime.core.loader import load_models


def main() -> None:
    models = load_models()
    output = []
    for model in models:
        output.append(model.spec.model_dump())
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    path = WEB_PUBLIC / "models.json"
    path.write_text(json.dumps({"models": output}, indent=2))
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
