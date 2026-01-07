from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class CheckResult:
    name: str
    status: str
    detail: str | None = None
    duration_ms: float | None = None


@dataclass
class SelfTestState:
    status: str = "pending"
    started_at: float | None = None
    finished_at: float | None = None
    checks: list[CheckResult] = field(default_factory=list)


class ReadinessTracker:
    """Tracks startup status, readiness, and self-test results."""

    def __init__(self) -> None:
        self.status = "starting"
        self.startup_checks: list[CheckResult] = []
        self.self_test = SelfTestState()
        self.defaults: dict[str, str] = {}
        self.platform_id: str | None = None
        self.loaded_models: list[str] = []
        self.last_error: str | None = None

    def mark_phase(self, name: str, status: str, detail: str | None = None, duration_ms: float | None = None) -> None:
        check = CheckResult(name=name, status=status, detail=detail, duration_ms=duration_ms)
        self.startup_checks.append(check)
        if status == "error":
            self.status = "error"
            self.last_error = detail or name
        elif status == "degraded" and self.status != "error":
            self.status = "degraded"

    def mark_ready(self) -> None:
        if self.status != "error":
            self.status = "ready"

    def mark_degraded(self, reason: str | None = None) -> None:
        if self.status != "error":
            self.status = "degraded"
            if reason:
                self.last_error = reason

    def mark_error(self, reason: str) -> None:
        self.status = "error"
        self.last_error = reason

    def begin_self_test(self) -> None:
        self.self_test.status = "running"
        self.self_test.started_at = time.time()
        self.self_test.checks.clear()

    def record_self_test_check(self, name: str, status: str, detail: str | None = None, duration_ms: float | None = None) -> None:
        self.self_test.checks.append(CheckResult(name=name, status=status, detail=detail, duration_ms=duration_ms))

    def finish_self_test(self, status: str) -> None:
        self.self_test.status = status
        self.self_test.finished_at = time.time()
        if status == "ok":
            self.mark_ready()
        elif status == "degraded":
            self.mark_degraded("self_test_failed")
        elif status == "error":
            self.mark_error("self_test_failed")

    def as_payload(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "platform_id": self.platform_id,
            "defaults": self.defaults,
            "loaded_models": self.loaded_models,
            "startup_checks": [check.__dict__ for check in self.startup_checks],
            "self_test": {
                "status": self.self_test.status,
                "started_at": self.self_test.started_at,
                "finished_at": self.self_test.finished_at,
                "checks": [check.__dict__ for check in self.self_test.checks],
            },
            "last_error": self.last_error,
        }
