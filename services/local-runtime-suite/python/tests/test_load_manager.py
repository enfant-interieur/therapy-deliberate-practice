from __future__ import annotations

import logging
from copy import deepcopy
from types import SimpleNamespace

import pytest

from local_runtime.core.load_manager import MAX_RETAINED_LOAD_JOBS, ModelLoadManager
from local_runtime.core.loader import LoadedModel
from local_runtime.core.readiness import ReadinessTracker
from local_runtime.core.registry import ModelRegistry
from local_runtime.models import model_template
from local_runtime.spec import ModelSpec


def _loaded_model(model_id: str, load) -> LoadedModel:
    spec_data = deepcopy(model_template.SPEC)
    spec_data["id"] = model_id
    spec = ModelSpec.model_validate(spec_data)
    return LoadedModel(
        name=f"local_runtime.models.{model_id.rsplit('/', 1)[-1]}",
        module=SimpleNamespace(load=load),
        spec=spec,
    )


@pytest.mark.asyncio
async def test_explicit_load_job_reports_backend_failure() -> None:
    async def failing_load(ctx):
        raise RuntimeError("model weights are unavailable")

    model_id = "local//test/failed-load"
    registry = ModelRegistry(
        [_loaded_model(model_id, failing_load)],
        "test-platform",
        logging.getLogger("test-load-job-failure"),
    )
    readiness = ReadinessTracker()
    manager = ModelLoadManager(registry, lambda request_id: None, readiness, registry.logger)

    job = manager.create_job([model_id])
    await manager.wait_for_job(job.id)

    assert job.status == "failed"
    assert job.statuses[model_id].status == "error"
    assert job.statuses[model_id].error == "model weights are unavailable"
    assert readiness.loaded_models == []


@pytest.mark.asyncio
async def test_explicit_load_job_records_loaded_models() -> None:
    async def successful_load(ctx):
        return object()

    model_id = "local//test/successful-load"
    registry = ModelRegistry(
        [_loaded_model(model_id, successful_load)],
        "test-platform",
        logging.getLogger("test-load-job-success"),
    )
    readiness = ReadinessTracker()
    manager = ModelLoadManager(registry, lambda request_id: None, readiness, registry.logger)

    job = manager.create_job([model_id])
    await manager.wait_for_job(job.id)

    assert job.status == "completed"
    assert job.statuses[model_id].status == "loaded"
    assert readiness.loaded_models == [model_id]


@pytest.mark.asyncio
async def test_completed_load_job_history_is_bounded() -> None:
    async def successful_load(ctx):
        return object()

    model_id = "local//test/bounded-load-history"
    registry = ModelRegistry(
        [_loaded_model(model_id, successful_load)],
        "test-platform",
        logging.getLogger("test-load-job-history"),
    )
    manager = ModelLoadManager(
        registry,
        lambda request_id: None,
        ReadinessTracker(),
        registry.logger,
    )
    created = []
    for _ in range(MAX_RETAINED_LOAD_JOBS + 5):
        job = manager.create_job([model_id])
        created.append(job.id)
        await manager.wait_for_job(job.id)

    assert len(manager.jobs) == MAX_RETAINED_LOAD_JOBS
    assert created[0] not in manager.jobs
    assert created[-1] in manager.jobs
