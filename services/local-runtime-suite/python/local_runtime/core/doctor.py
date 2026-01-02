from __future__ import annotations

import sys
from dataclasses import dataclass


@dataclass
class DoctorCheck:
    title: str
    status: str
    details: str
    fix: str | None = None


def run_doctor() -> list[DoctorCheck]:
    checks: list[DoctorCheck] = []
    checks.append(
        DoctorCheck(
            title="Python version",
            status="ok" if sys.version_info >= (3, 10) else "error",
            details=f"Running {sys.version.split()[0]}",
            fix="Install Python 3.10+ and set it as the default interpreter.",
        )
    )
    return checks
