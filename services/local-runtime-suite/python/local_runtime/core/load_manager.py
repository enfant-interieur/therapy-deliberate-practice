from __future__ import annotations

import asyncio
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from local_runtime.core.assets import PreparationCancelled
from local_runtime.core.readiness import ReadinessTracker
from local_runtime.core.registry import ModelRegistry

MAX_RETAINED_LOAD_JOBS = 100


@dataclass
class ModelStatus:
    model_id: str
    status: str = "pending"
    started_at: float | None = None
    finished_at: float | None = None
    duration_ms: float | None = None
    error: str | None = None
    stage: str = "pending"
    completed_bytes: int = 0
    total_bytes: int = 0

    def to_dict(self) -> dict:
        return {
            "model_id": self.model_id,
            "status": self.status,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "duration_ms": self.duration_ms,
            "error": self.error,
            "stage": self.stage,
            "completed_bytes": self.completed_bytes,
            "total_bytes": self.total_bytes,
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
    cancel: threading.Event = field(default_factory=threading.Event)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "models": [status.to_dict() for status in self.statuses.values()],
            "cancellation_requested": self.cancel.is_set(),
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

    def request_cancel(self, job_id: str) -> ModelLoadJob | None:
        job = self.jobs.get(job_id)
        if job and job.finished_at is None:
            job.cancel.set()
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
        self.logger.info("models.load.start", extra={"job_id": job.id, "targets": job.models})
        # Preparing large checkpoints sequentially avoids simultaneous peaks in
        # disk traffic and memory. Health and inventory remain asynchronous.
        for model_id in job.models:
            await self._load_single(job, model_id)
        job.finished_at = time.time()
        if any(status.status == "error" for status in job.statuses.values()):
            job.status = "failed"
        elif job.cancel.is_set():
            job.status = "cancelled"
        else:
            job.status = "completed"
        self.readiness.loaded_models = sorted(self.registry.model_instances.keys())
        self._prune_finished_jobs()
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

    def _prune_finished_jobs(self) -> None:
        finished = sorted(
            (candidate for candidate in self.jobs.values() if candidate.finished_at is not None),
            key=lambda candidate: candidate.finished_at or candidate.created_at,
        )
        for expired in finished[:-MAX_RETAINED_LOAD_JOBS]:
            self.jobs.pop(expired.id, None)

    async def _load_single(self, job: ModelLoadJob, model_id: str) -> None:
        status = job.statuses[model_id]
        if job.cancel.is_set():
            status.status = "cancelled"
            status.stage = "cancelled"
            return
        status.status = "loading"
        status.started_at = time.time()
        ctx_label = f"loadjob:{job.id}:{model_id}"

        def progress(stage, completed, total):
            status.stage = stage
            status.completed_bytes = completed
            status.total_bytes = total

        def context(label):
            ctx = self.ctx_factory(f"{ctx_label}:{label}")
            if ctx is not None:
                ctx.load_progress = progress
                ctx.preparation_cancel = job.cancel
            return ctx

        try:
            success = await self.registry.preload_model(
                model_id,
                context,
                raise_errors=True,
            )
            if success:
                status.status = "loaded"
                status.stage = "loaded"
            else:
                status.status = "skipped"
        except PreparationCancelled:
            status.status = "cancelled"
            status.stage = "cancelled"
        except Exception:  # noqa: BLE001 - never expose arbitrary backend content
            status.status = "error"
            status.stage = "error"
            status.error = (
                "Model preparation failed. Check storage, network and platform support, then retry."
            )
        finally:
            status.finished_at = time.time()
            status.duration_ms = round((status.finished_at - status.started_at) * 1000, 2)
