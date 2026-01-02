from __future__ import annotations

import json
from pathlib import Path


def main() -> None:
    output = Path(__file__).resolve().parents[1] / "site" / "public" / "releases.json"
    if not output.exists():
        output.write_text(json.dumps({"releases": []}, indent=2))
    print(f"wrote {output}")


if __name__ == "__main__":
    main()
