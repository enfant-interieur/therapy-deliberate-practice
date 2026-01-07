from __future__ import annotations

import asyncio
import inspect
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

from local_runtime.core.loader import LoadedModel


@dataclass
class LifecycleHooks:
    startup: Callable | None = None
    load: Callable | None = None
    warmup: Callable | None = None
    shutdown: Callable | None = None


class ModelRegistry:
    """Central registry that tracks model metadata and loaded instances."""

    def __init__(self, models: Iterable[LoadedModel], platform_id: str, logger: logging.Logger):
        self.platform_id = platform_id
        self.logger = logger
        self._models: list[LoadedModel] = list(models)
        self._models_by_id: dict[str, LoadedModel] = {m.spec.id: m for m in self._models}
        self.models_by_endpoint: dict[str, list[LoadedModel]] = {}
        self.selected_defaults: dict[str, str] = {}
        self.model_instances: dict[str, Any] = {}
        self.capabilities: dict[str, dict[str, Any]] = {}
        self._hooks: dict[str, LifecycleHooks] = {}
        self._build_indexes()

    def _build_indexes(self) -> None:
        for loaded in self._models:
            endpoint = loaded.spec.api.endpoint
            self.models_by_endpoint.setdefault(endpoint, []).append(loaded)
            self.capabilities[loaded.spec.id] = {
                "endpoint": endpoint,
                "provider": loaded.spec.backend.provider,
                "priority": loaded.spec.compat.priority,
                "supports_stream": loaded.spec.api.supports_stream,
                "kind": loaded.spec.kind,
            }
            self._hooks[loaded.spec.id] = LifecycleHooks(
                startup=getattr(loaded.module, "startup", None),
                load=getattr(loaded.module, "load", None),
                warmup=getattr(loaded.module, "warmup", None),
                shutdown=getattr(loaded.module, "shutdown", None),
            )
        for endpoint in self.models_by_endpoint:
            self.models_by_endpoint[endpoint].sort(key=lambda lm: lm.spec.compat.priority, reverse=True)

    def get_loaded(self, model_id: str) -> LoadedModel | None:
        return self._models_by_id.get(model_id)

    def set_defaults(self, defaults: dict[str, str]) -> None:
        self.selected_defaults = defaults

    def list_models(self) -> list[LoadedModel]:
        return list(self._models)

    async def run_startup_hooks(self, ctx_factory: Callable[[str], Any]) -> None:
        for model_id, hooks in self._hooks.items():
            if not hooks.startup:
                continue
            ctx = ctx_factory(f"startup:{model_id}")
            await self._call_hook(hooks.startup, ctx, model_id=model_id, phase="startup")

    async def preload(self, model_ids: Iterable[str], ctx_factory: Callable[[str], Any]) -> list[str]:
        targets = [m for m in dict.fromkeys(model_ids) if m in self._models_by_id]
        loaded: list[str] = []
        for model_id in targets:
            success = await self._preload_model(model_id, ctx_factory)
            if success:
                loaded.append(model_id)
        return loaded

    async def preload_model(self, model_id: str, ctx_factory: Callable[[str], Any]) -> bool:
        return await self._preload_model(model_id, ctx_factory)

    async def ensure_instance(self, model_id: str, ctx: Any) -> Any:
        if model_id in self.model_instances:
            return self.model_instances[model_id]
        loaded = self._models_by_id.get(model_id)
        if not loaded:
            raise KeyError(f"Unknown model_id={model_id}")
        hooks = self._hooks.get(model_id)
        if not hooks or not hooks.load:
            self.logger.info(
                "model.lazy_load",
                extra={"model_id": model_id, "reason": "missing_load_hook"},
            )
            return None
        instance = await self._call_hook(hooks.load, ctx, model_id=model_id, phase="load")
        self.model_instances[model_id] = instance
        return instance

    async def shutdown(self, ctx_factory: Callable[[str], Any]) -> None:
        for model_id, hooks in self._hooks.items():
            if not hooks.shutdown or model_id not in self.model_instances:
                continue
            ctx = ctx_factory(f"shutdown:{model_id}")
            instance = self.model_instances[model_id]
            await self._call_hook(hooks.shutdown, instance, ctx, model_id=model_id, phase="shutdown")

    async def _preload_model(self, model_id: str, ctx_factory: Callable[[str], Any]) -> bool:
        hooks = self._hooks.get(model_id)
        loaded = self._models_by_id.get(model_id)
        if not loaded:
            return False
        if model_id in self.model_instances:
            self.logger.info(
                "model.preload.skipped",
                extra={"model_id": model_id, "reason": "already_loaded"},
            )
            return True
        if not hooks or not hooks.load:
            self.logger.info(
                "model.preload.skipped",
                extra={"model_id": model_id, "reason": "no_load_hook"},
            )
            return False
        ctx = ctx_factory(f"preload:{model_id}")
        start = time.perf_counter()
        try:
            instance = await self._call_hook(hooks.load, ctx, model_id=model_id, phase="preload")
        except Exception:
            self.logger.error(
                "model.preload.failed",
                extra={"model_id": model_id},
            )
            return False
        self.model_instances[model_id] = instance
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        self.logger.info("model.preload.ok", extra={"model_id": model_id, "duration_ms": duration_ms})
        if hooks.warmup:
            warmup_ctx = ctx_factory(f"warmup:{model_id}")
            await self._call_hook(hooks.warmup, instance, warmup_ctx, model_id=model_id, phase="warmup")
        return True

    async def _call_hook(self, hook: Callable, *args, model_id: str, phase: str):
        self.logger.info(
            "model.lifecycle.start",
            extra={"model_id": model_id, "phase": phase},
        )
        start = time.perf_counter()
        try:
            if inspect.iscoroutinefunction(hook):
                result = await hook(*args)
            else:
                result = await asyncio.to_thread(hook, *args)
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            self.logger.info(
                "model.lifecycle.done",
                extra={"model_id": model_id, "phase": phase, "duration_ms": duration_ms},
            )
            return result
        except Exception:
            self.logger.exception("model.lifecycle.error", extra={"model_id": model_id, "phase": phase})
            raise
