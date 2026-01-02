#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WEB_PUBLIC = ROOT / "apps" / "web" / "public" / "local-suite"


def main() -> None:
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    path = WEB_PUBLIC / "releases.json"
    payload = {
        "generated": True,
        "assets": {
            "windows": None,
            "macos": None,
            "linux": None,
        },
    }
    path.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()
