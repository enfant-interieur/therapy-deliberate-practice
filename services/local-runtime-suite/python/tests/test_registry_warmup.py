from __future__ import annotations

import asyncio
import logging
import threading
from copy import deepcopy
from types import SimpleNamespace

import pytest

from local_runtime.core.loader import LoadedModel
from local_runtime.core.registry import ModelRegistry
from local_runtime.models import model_template
from local_runtime.spec import ModelSpec


def _build_spec(warmup_on_start: bool, suffix: str) -> ModelSpec:
    spec_data = deepcopy(model_template.SPEC)
    spec_data["id"] = f"local//test/{suffix}"
    spec_data["execution"]["warmup_on_start"] = warmup_on_start
    return ModelSpec.model_validate(spec_data)


@pytest.mark.asyncio
async def test_registry_warmup_toggle() -> None:
    spec = _build_spec(True, "warmup-enabled")
    calls: dict[str, int] = {"load": 0, "warmup": 0}

    async def load(ctx):
        calls["load"] += 1
        return {"instance": "ok"}

    async def warmup(instance, ctx):
        calls["warmup"] += 1

    module = SimpleNamespace(load=load, warmup=warmup)
    loaded = LoadedModel(name="local_runtime.models.model_test", module=module, spec=spec)

    registry_disabled = ModelRegistry(
        [loaded],
        "test-platform",
        logging.getLogger("test-registry-warmup"),
        enable_warmup=False,
    )
    assert await registry_disabled.preload_model(spec.id, lambda rid: None)
    assert calls["load"] == 1
    assert calls["warmup"] == 0

    calls["warmup"] = 0
    registry_enabled = ModelRegistry(
        [loaded],
        "test-platform",
        logging.getLogger("test-registry-warmup"),
        enable_warmup=True,
    )
    assert await registry_enabled.preload_model(spec.id, lambda rid: None)
    assert calls["warmup"] == 1


@pytest.mark.asyncio
async def test_registry_warmup_respects_spec_flag() -> None:
    spec = _build_spec(False, "warmup-disabled")
    calls: dict[str, int] = {"warmup": 0}

    async def load(ctx):
        return {"instance": "ok"}

    async def warmup(instance, ctx):
        calls["warmup"] += 1

    module = SimpleNamespace(load=load, warmup=warmup)
    loaded = LoadedModel(name="local_runtime.models.model_test", module=module, spec=spec)
    registry = ModelRegistry(
        [loaded],
        "test-platform",
        logging.getLogger("test-registry-warmup"),
        enable_warmup=True,
    )
    assert await registry.preload_model(spec.id, lambda rid: None)
    assert calls["warmup"] == 0


@pytest.mark.asyncio
async def test_concurrent_ensure_calls_share_one_load() -> None:
    spec = _build_spec(False, "concurrent-ensure")
    calls = 0

    async def load(ctx):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return object()

    module = SimpleNamespace(load=load)
    loaded = LoadedModel(name="local_runtime.models.model_test", module=module, spec=spec)
    registry = ModelRegistry(
        [loaded],
        "test-platform",
        logging.getLogger("test-registry-concurrent-ensure"),
    )

    first, second = await asyncio.gather(
        registry.ensure_instance(spec.id, None),
        registry.ensure_instance(spec.id, None),
    )

    assert calls == 1
    assert first is second


@pytest.mark.asyncio
async def test_preload_and_ensure_share_one_load() -> None:
    spec = _build_spec(False, "concurrent-preload")
    calls = 0

    async def load(ctx):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return object()

    module = SimpleNamespace(load=load)
    loaded = LoadedModel(name="local_runtime.models.model_test", module=module, spec=spec)
    registry = ModelRegistry(
        [loaded],
        "test-platform",
        logging.getLogger("test-registry-concurrent-preload"),
    )

    preload_succeeded, instance = await asyncio.gather(
        registry.preload_model(spec.id, lambda request_id: None),
        registry.ensure_instance(spec.id, None),
    )

    assert preload_succeeded
    assert calls == 1
    assert instance is registry.model_instances[spec.id]


@pytest.mark.asyncio
async def test_failed_load_can_be_retried() -> None:
    spec = _build_spec(False, "retry-after-failure")
    calls = 0
    expected_instance = object()

    async def load(ctx):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("first load failed")
        return expected_instance

    module = SimpleNamespace(load=load)
    loaded = LoadedModel(name="local_runtime.models.model_test", module=module, spec=spec)
    registry = ModelRegistry(
        [loaded],
        "test-platform",
        logging.getLogger("test-registry-retry"),
    )

    with pytest.raises(RuntimeError, match="first load failed"):
        await registry.ensure_instance(spec.id, None)

    assert spec.id not in registry.model_instances
    assert await registry.ensure_instance(spec.id, None) is expected_instance
    assert calls == 2


@pytest.mark.asyncio
async def test_cancelled_waiter_does_not_duplicate_synchronous_load() -> None:
    spec = _build_spec(False, "cancelled-sync-load")
    loader_started = threading.Event()
    release_loader = threading.Event()
    calls = 0
    expected_instance = object()

    def load(ctx):
        nonlocal calls
        calls += 1
        loader_started.set()
        if not release_loader.wait(timeout=2):
            raise TimeoutError("test did not release synchronous loader")
        return expected_instance

    module = SimpleNamespace(load=load)
    loaded = LoadedModel(name="local_runtime.models.model_test", module=module, spec=spec)
    registry = ModelRegistry(
        [loaded],
        "test-platform",
        logging.getLogger("test-registry-cancelled-sync-load"),
    )

    first_waiter = asyncio.create_task(registry.ensure_instance(spec.id, None))
    assert await asyncio.to_thread(loader_started.wait, 1)
    first_waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first_waiter

    second_waiter = asyncio.create_task(registry.ensure_instance(spec.id, None))
    try:
        await asyncio.sleep(0.02)
        assert calls == 1
    finally:
        release_loader.set()

    assert await second_waiter is expected_instance
    assert calls == 1
