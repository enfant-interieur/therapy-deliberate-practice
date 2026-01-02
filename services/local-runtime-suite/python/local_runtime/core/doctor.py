from __future__ import annotations

import shutil


def run_checks() -> list[str]:
    fixes: list[str] = []
    if shutil.which("ffmpeg") is None:
        fixes.append("ffmpeg: missing (Fix: brew install ffmpeg / choco install ffmpeg)")
    return fixes


def main() -> None:
    fixes = run_checks()
    if not fixes:
        print("[doctor] all good")
        return
    for fix in fixes:
        print(f"[doctor] {fix}")


if __name__ == "__main__":
    main()
