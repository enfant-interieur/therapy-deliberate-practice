from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class WorkerStatus:
    name: str
    running: bool = False
    pid: int | None = None
    last_error: str | None = None


@dataclass
class Supervisor:
    workers: dict[str, WorkerStatus] = field(default_factory=dict)

    def status(self) -> list[WorkerStatus]:
        return list(self.workers.values())

    def ensure_worker(self, name: str) -> WorkerStatus:
        status = self.workers.get(name)
        if status is None:
            status = WorkerStatus(name=name, running=False)
            self.workers[name] = status
        return status
