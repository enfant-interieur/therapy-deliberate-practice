from __future__ import annotations

import logging

import pytest

from local_runtime.core.config import RuntimeConfig
from local_runtime.core.loader import load_models
from local_runtime.core.readiness import ReadinessTracker
from local_runtime.core.registry import ModelRegistry
from local_runtime.core.selector import detect_platform
from local_runtime.core.selftest import run_startup_self_test
from local_runtime.runtime_types import RunContext


@pytest.mark.asyncio
async def test_selftest_runner_succeeds(tmp_path):
    config = RuntimeConfig(
        data_dir=str(tmp_path / "data"),
        cache_dir=str(tmp_path / "cache"),
    )
    config.ensure_dirs()
    models = load_models()
    registry = ModelRegistry(models, detect_platform(), logging.getLogger("test-selftest"))
    defaults: dict[str, str] = {}
    for endpoint, entries in registry.models_by_endpoint.items():
        if entries:
            defaults[endpoint] = entries[0].spec.id
    readiness = ReadinessTracker()

    def ctx_factory(request_id: str, endpoint: str | None = None, model_id: str | None = None) -> RunContext:
        return RunContext(
            request_id=request_id,
            logger=logging.getLogger("test-selftest"),
            data_dir=config.data_dir,
            cache_dir=config.cache_dir,
            platform=registry.platform_id,
            registry=registry,
            http_client=None,
            cancellation_token=None,
        )

    await run_startup_self_test(registry, defaults, ctx_factory, readiness, strict=False)
    assert readiness.self_test.status == "ok"
