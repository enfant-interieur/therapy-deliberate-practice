from __future__ import annotations

import json
from pathlib import Path

from local_runtime.core.loader import discover_modules


def main() -> None:
    models = [mod.spec.model_dump() for mod in discover_modules()]
    output = Path(__file__).resolve().parents[1] / "site" / "public" / "models.json"
    output.write_text(json.dumps(models, indent=2))
    print(f"wrote {output}")


if __name__ == "__main__":
    main()
