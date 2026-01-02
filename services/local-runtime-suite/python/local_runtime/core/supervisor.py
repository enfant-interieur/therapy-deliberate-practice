from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class WorkerStatus:
    name: str
    running: bool
    info: dict[str, Any] = field(default_factory=dict)


class Supervisor:
    def __init__(self) -> None:
        self._workers: dict[str, WorkerStatus] = {}

    def start_worker(self, name: str) -> WorkerStatus:
        status = WorkerStatus(name=name, running=True)
        self._workers[name] = status
        return status

    def stop_worker(self, name: str) -> None:
        if name in self._workers:
            self._workers[name].running = False

    def status(self) -> list[WorkerStatus]:
        return list(self._workers.values())
