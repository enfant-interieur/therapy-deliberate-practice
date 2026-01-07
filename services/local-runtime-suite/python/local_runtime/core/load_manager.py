from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

from local_runtime.core.registry import ModelRegistry
from local_runtime.core.readiness import ReadinessTracker


@dataclass
class ModelStatus:
    model_id: str
    status: str = "pending"
    started_at: float | None = None
    finished_at: float | None = None
    duration_ms: float | None = None
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "model_id": self.model_id,
            "status": self.status,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "duration_ms": self.duration_ms,
            "error": self.error,
        }


@dataclass
class ModelLoadJob:
    id: str
    models: list[str]
    statuses: dict[str, ModelStatus] = field(default_factory=dict)
    status: str = "pending"
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    task: asyncio.Task | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "models": [status.to_dict() for status in self.statuses.values()],
        }


class ModelLoadManager:
    def __init__(
        self,
        registry: ModelRegistry,
        ctx_factory: Callable[[str], Any],
        readiness: ReadinessTracker,
        logger,
    ):
        self.registry = registry
        self.ctx_factory = ctx_factory
        self.readiness = readiness
        self.logger = logger
        self.jobs: dict[str, ModelLoadJob] = {}

    def create_job(self, models: list[str]) -> ModelLoadJob:
        deduped = list(dict.fromkeys(models))
        job_id = f"load_{uuid.uuid4().hex}"
        job = ModelLoadJob(id=job_id, models=deduped)
        job.statuses = {model_id: ModelStatus(model_id=model_id) for model_id in deduped}
        self.jobs[job_id] = job
        job.task = asyncio.create_task(self._run_job(job))
        return job

    async def wait_for_job(self, job_id: str) -> ModelLoadJob:
        job = self.jobs[job_id]
        if job.task:
            await job.task
        return job

    def get_job(self, job_id: str) -> ModelLoadJob | None:
        return self.jobs.get(job_id)

    async def _run_job(self, job: ModelLoadJob) -> None:
        job.status = "running"
        job.started_at = time.time()
        self.logger.info(
            "models.load.start", extra={"job_id": job.id, "targets": job.models}
        )
        tasks = [asyncio.create_task(self._load_single(job, model_id)) for model_id in job.models]
        await asyncio.gather(*tasks)
        job.finished_at = time.time()
        if any(status.status == "error" for status in job.statuses.values()):
            job.status = "failed"
        else:
            job.status = "completed"
        self.readiness.loaded_models = sorted(self.registry.model_instances.keys())
        self.logger.info(
            "models.load.done",
            extra={
                "job_id": job.id,
                "status": job.status,
                "duration_ms": round((job.finished_at - job.started_at) * 1000, 2)
                if job.finished_at and job.started_at
                else None,
            },
        )

    async def _load_single(self, job: ModelLoadJob, model_id: str) -> None:
        status = job.statuses[model_id]
        status.status = "loading"
        status.started_at = time.time()
        ctx_label = f"loadjob:{job.id}:{model_id}"
        try:
            success = await self.registry.preload_model(
                model_id,
                lambda label: self.ctx_factory(f"{ctx_label}:{label}"),
            )
            if success:
                status.status = "loaded"
            else:
                status.status = "skipped"
        except Exception as exc:  # pragma: no cover - registry already logs details
            status.status = "error"
            status.error = str(exc)
        finally:
            status.finished_at = time.time()
            status.duration_ms = round((status.finished_at - status.started_at) * 1000, 2)
