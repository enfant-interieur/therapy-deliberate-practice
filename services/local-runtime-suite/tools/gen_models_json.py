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


def same_json(actual: object, expected: object) -> bool:
    """Compare JSON data while keeping booleans distinct from numbers."""
    if isinstance(expected, dict):
        return (
            isinstance(actual, dict)
            and actual.keys() == expected.keys()
            and all(same_json(actual[key], value) for key, value in expected.items())
        )
    if isinstance(expected, list):
        return (
            isinstance(actual, list)
            and len(actual) == len(expected)
            and all(same_json(a, b) for a, b in zip(actual, expected, strict=True))
        )
    if isinstance(expected, bool):
        return isinstance(actual, bool) and actual == expected
    return not isinstance(actual, bool) and actual == expected


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the executable model catalog")
    parser.add_argument("--output", type=Path, default=WEB_PUBLIC / "models.json")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check catalogue data without changing its formatting",
    )
    args = parser.parse_args()
    models = load_models()
    output = []
    for model in models:
        output.append(model.spec.model_dump())
    path = args.output
    payload = {'models': output}
    if args.check:
        if not path.is_file() or not same_json(json.loads(path.read_text()), payload):
            raise SystemExit(
                "The committed model catalogue differs from the executable model definitions."
            )
        print(f"Verified {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2)}\n")
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
