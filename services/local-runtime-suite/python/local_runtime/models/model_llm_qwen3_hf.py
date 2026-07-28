from __future__ import annotations

import asyncio
import os
import threading
import time
from collections.abc import AsyncIterator
from functools import lru_cache
from typing import Any

from local_runtime.cancellation import CancellationToken, acquire_model_lock
from local_runtime.helpers.responses_helpers import new_response
from local_runtime.runtime_types import RunContext, RunRequest

SPEC = {
    "id": "local//llm/qwen3-hf",
    "kind": "llm",
    "display": {
        "title": "Qwen3 HF",
        "description": "Qwen3-4B Instruct inference via Transformers.",
        "tags": ["qwen", "hf", "local"],
        "icon": "bolt",
    },
    "compat": {
        "platforms": ["darwin-arm64", "windows-x64", "linux-x64"],
        "acceleration": ["cpu", "metal"],
        "priority": 90,
        "requires_ram_gb": 8,
        "requires_vram_gb": 0,
        "disk_gb": 10,
    },
    "api": {
        "endpoint": "responses",
        "advertised_model_name": "qwen3-hf",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 300,
        "concurrency": 1,
        "max_input_mb": 25,
        "max_output_tokens_default": 1024,
    },
    "backend": {
        "provider": "hf",
        "model_ref": "Qwen/Qwen3-4B-Instruct-2507",
        "revision": "cdbee75f17c01a7cc42f958dc650907174af0554",
        "device_hint": "auto",
        "extra": {},
    },
    "execution": {
        "mode": "inprocess",
        "warmup_on_start": False,
    },
    "launch": {
        "enabled": False,
        "type": "command",
        "explain": "Runs in-process via transformers.",
        "env": {},
        "cmd": ["python", "-m", "local_runtime"],
        "ready": {
            "kind": "http",
            "timeout_sec": 60,
            "http_url": "http://127.0.0.1:{port}/health",
            "log_regex": "READY",
        },
    },
    "ui_params": [],
    "deps": {
        "python_extras": ["hf"],
        "pip": ["transformers>=5.14.1,<6", "torch==2.13.0"],
        "system": [],
        "notes": (
            "Requires Transformers causal-language-model support for Qwen3. "
            "The packaged Windows and Linux runtime uses the official PyTorch CPU wheel. "
            "PyTorch 2.13 does not publish an Intel macOS wheel."
        ),
    },
}

DEFAULT_MAX_TOKENS = int(
    os.getenv("LOCAL_RUNTIME_QWEN_HF_MAX_TOKENS", SPEC["limits"]["max_output_tokens_default"])
)
DEFAULT_TEMPERATURE = float(os.getenv("LOCAL_RUNTIME_QWEN_HF_TEMPERATURE", "0.7"))
DEFAULT_TOP_P = float(os.getenv("LOCAL_RUNTIME_QWEN_HF_TOP_P", "0.8"))
DEFAULT_TOP_K = int(os.getenv("LOCAL_RUNTIME_QWEN_HF_TOP_K", "20"))


@lru_cache(maxsize=1)
def _load_backend() -> tuple[Any, Any, Any, Any]:
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer
    except ImportError as exc:
        raise RuntimeError("Qwen3 HF requires the packaged torch and transformers dependencies.") from exc
    return torch, AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer


def _prepare_prompt(payload: dict | None, tokenizer: Any | None = None) -> str:
    if not payload:
        return "You are a helpful assistant."
    messages = payload.get("messages")
    if messages:
        if tokenizer and getattr(tokenizer, "chat_template", None):
            return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        return "\n".join(f"{m.get('role', 'user')}: {m.get('content', '')}" for m in messages)
    if isinstance(payload.get("input"), list):
        parts: list[str] = []
        for entry in payload["input"]:
            if isinstance(entry, str):
                parts.append(entry)
            elif isinstance(entry, dict) and entry.get("type") == "text" and "text" in entry:
                parts.append(str(entry["text"]))
        if parts:
            return "\n".join(parts)
    if isinstance(payload.get("input"), str):
        return payload["input"]
    if payload.get("prompt"):
        return str(payload["prompt"])
    return "You are a helpful assistant."


def _generation_params(payload: dict | None) -> dict[str, Any]:
    payload = payload or {}

    def _bounded_float(value: Any, default: float, lower: float, upper: float) -> float:
        try:
            parsed = float(default if value is None else value)
        except (TypeError, ValueError):
            parsed = default
        return max(lower, min(parsed, upper))

    try:
        requested_tokens = int(payload.get("max_output_tokens") or DEFAULT_MAX_TOKENS)
    except (TypeError, ValueError):
        requested_tokens = DEFAULT_MAX_TOKENS
    try:
        requested_top_k = int(payload.get("top_k") or DEFAULT_TOP_K)
    except (TypeError, ValueError):
        requested_top_k = DEFAULT_TOP_K

    return {
        "max_new_tokens": max(
            1,
            min(
                requested_tokens,
                int(SPEC["limits"]["max_output_tokens_default"]) * 4,
            ),
        ),
        "temperature": _bounded_float(payload.get("temperature"), DEFAULT_TEMPERATURE, 0.0, 2.0),
        "top_p": _bounded_float(payload.get("top_p"), DEFAULT_TOP_P, 0.01, 1.0),
        "top_k": max(1, min(requested_top_k, 100)),
    }


def _generation_kwargs(params: dict[str, Any]) -> dict[str, Any]:
    do_sample = params["temperature"] > 0
    kwargs: dict[str, Any] = {
        "max_new_tokens": params["max_new_tokens"],
        "do_sample": do_sample,
    }
    if do_sample:
        kwargs["temperature"] = params["temperature"]
        kwargs["top_p"] = params["top_p"]
        kwargs["top_k"] = params["top_k"]
    return kwargs


def _cancellation_stopping_criteria(token: CancellationToken | None):
    if token is None:
        return None
    from transformers import StoppingCriteria, StoppingCriteriaList  # type: ignore

    class CancellationStoppingCriteria(StoppingCriteria):
        def __call__(self, *_args, **_kwargs):
            return token.cancelled

    return StoppingCriteriaList([CancellationStoppingCriteria()])


def _select_device() -> str:
    torch, _, _, _ = _load_backend()
    override = os.getenv("LOCAL_RUNTIME_QWEN3_HF_DEVICE")
    if override:
        return override
    if torch.cuda.is_available():
        return "cuda"
    mps = getattr(torch.backends, "mps", None)
    if mps and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def load(ctx: RunContext) -> dict[str, Any]:
    _, AutoModelForCausalLM, AutoTokenizer, _ = _load_backend()
    model_ref = os.getenv("LOCAL_RUNTIME_QWEN3_HF_MODEL", SPEC["backend"]["model_ref"])
    revision = os.getenv("LOCAL_RUNTIME_QWEN3_HF_REVISION") or SPEC["backend"]["revision"]
    ctx.logger.info(
        "qwen3_hf.load.start",
        extra={"model_id": SPEC["id"], "repo": model_ref, "revision": revision},
    )
    try:
        tokenizer = AutoTokenizer.from_pretrained(
            model_ref,
            revision=revision,
            trust_remote_code=False,
            cache_dir=ctx.cache_dir,
        )
        model = AutoModelForCausalLM.from_pretrained(
            model_ref,
            revision=revision,
            trust_remote_code=False,
            torch_dtype="auto",
            cache_dir=ctx.cache_dir,
        )
    except Exception as exc:  # pragma: no cover - surfaced via startup logs
        raise RuntimeError(
            "Failed to load transformers weights for Qwen3 HF. Ensure the repo contains compatible files."
        ) from exc
    device = _select_device()
    model.to(device)
    model.eval()
    ctx.logger.info("qwen3_hf.load.ready", extra={"model_id": SPEC["id"], "device": device})
    return {
        "model": model,
        "tokenizer": tokenizer,
        "device": device,
        "model_ref": model_ref,
        "revision": revision,
        "lock": threading.Lock(),
    }


def warmup(instance: dict[str, Any], ctx: RunContext) -> None:
    torch, _, _, _ = _load_backend()
    tokenizer = instance["tokenizer"]
    model = instance["model"]
    device = instance["device"]
    prompt = "Hello from warmup."
    ctx.logger.info("qwen3_hf.warmup.start", extra={"model_id": SPEC["id"], "device": device})
    start = time.perf_counter()

    def _invoke() -> None:
        with torch.inference_mode():
            prompt_inputs = tokenizer(prompt, return_tensors="pt").to(device)
            with instance["lock"]:
                model.generate(**prompt_inputs, max_new_tokens=8)

    try:
        _invoke()
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        ctx.logger.info(
            "qwen3_hf.warmup.done",
            extra={"model_id": SPEC["id"], "device": device, "duration_ms": duration_ms},
        )
    except Exception as exc:
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        ctx.logger.exception(
            "qwen3_hf.warmup.error",
            extra={"model_id": SPEC["id"], "device": device, "duration_ms": duration_ms, "error": str(exc)},
        )


async def _generate(
    instance: dict[str, Any],
    prompt: str,
    params: dict[str, Any],
    token: CancellationToken | None = None,
) -> str:
    torch, _, _, _ = _load_backend()
    tokenizer = instance["tokenizer"]
    model = instance["model"]
    device = instance["device"]

    def _invoke() -> str:
        if token is not None:
            token.raise_if_cancelled()
        inputs = tokenizer(prompt, return_tensors="pt").to(device)
        generation_kwargs = _generation_kwargs(params)
        stopping_criteria = _cancellation_stopping_criteria(token)
        if stopping_criteria is not None:
            generation_kwargs["stopping_criteria"] = stopping_criteria
        with torch.inference_mode(), acquire_model_lock(instance["lock"], token):
            output = model.generate(**inputs, **generation_kwargs)
        if token is not None:
            token.raise_if_cancelled()
        generated = output[0][inputs.input_ids.shape[-1] :]
        return tokenizer.decode(generated, skip_special_tokens=True)

    return await asyncio.to_thread(_invoke)


async def _generate_stream(
    instance: dict[str, Any],
    prompt: str,
    params: dict[str, Any],
    token: CancellationToken | None = None,
) -> AsyncIterator[str]:
    torch, _, _, TextIteratorStreamer = _load_backend()
    tokenizer = instance["tokenizer"]
    model = instance["model"]
    device = instance["device"]
    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str | Exception | None] = asyncio.Queue()
    ready: asyncio.Future[None] = loop.create_future()

    def _mark_ready() -> None:
        if not ready.done():
            ready.set_result(None)

    def _mark_failed(exc: Exception) -> None:
        if not ready.done():
            ready.set_exception(exc)

    def _worker() -> None:
        try:
            if token is not None:
                token.raise_if_cancelled()
            inputs = tokenizer(prompt, return_tensors="pt").to(device)
            generation_kwargs = dict(
                **inputs,
                **_generation_kwargs(params),
                streamer=streamer,
            )
            stopping_criteria = _cancellation_stopping_criteria(token)
            if stopping_criteria is not None:
                generation_kwargs["stopping_criteria"] = stopping_criteria
            with torch.inference_mode(), acquire_model_lock(instance["lock"], token):
                loop.call_soon_threadsafe(_mark_ready)
                model.generate(**generation_kwargs)
            if token is not None:
                token.raise_if_cancelled()
        except Exception as exc:  # noqa: BLE001 - propagate arbitrary backend errors to the async caller
            loop.call_soon_threadsafe(_mark_failed, exc)
            loop.call_soon_threadsafe(queue.put_nowait, exc)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    def _drain_streamer() -> None:
        try:
            for streamed_token in streamer:
                loop.call_soon_threadsafe(queue.put_nowait, streamed_token)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=_worker, daemon=True).start()
    await ready
    threading.Thread(target=_drain_streamer, daemon=True).start()

    async def _events() -> AsyncIterator[str]:
        pending_eof = 2
        try:
            while pending_eof:
                item = await queue.get()
                if item is None:
                    pending_eof -= 1
                    continue
                if isinstance(item, Exception):
                    raise item
                yield item
        finally:
            if pending_eof and token is not None:
                token.cancel()

    return _events()


async def run(req: RunRequest, ctx: RunContext):
    payload = req.payload or {}
    model_id = req.model or SPEC["id"]
    instance = await ctx.registry.ensure_instance(model_id, ctx)
    if not instance:
        raise RuntimeError("Qwen3 HF model not initialized.")
    prompt = _prepare_prompt(payload, tokenizer=instance.get("tokenizer"))
    params = _generation_params(payload)
    run_meta = {
        "model_id": model_id,
        "stream": bool(req.stream),
        "prompt_chars": len(prompt),
    }
    ctx.logger.info("qwen3_hf.run.start", extra=run_meta)
    start = time.perf_counter()

    if req.stream:
        chunks = await _generate_stream(
            instance,
            prompt,
            params,
            ctx.cancellation_token,
        )

        async def generator() -> AsyncIterator[dict]:
            response = new_response(model_id, "", request_id=ctx.request_id)
            yield {"event": "response.created", "data": response}
            accumulated = ""
            try:
                async for chunk in chunks:
                    if not chunk:
                        continue
                    accumulated += chunk
                    yield {
                        "event": "response.output_text.delta",
                        "data": {"id": response["id"], "delta": chunk},
                    }
                response["output_text"] = accumulated
                response["output"][0]["content"][0]["text"] = accumulated
                yield {
                    "event": "response.output_text.done",
                    "data": {"id": response["id"], "text": accumulated},
                }
                yield {"event": "response.completed", "data": response}
            finally:
                duration_ms = round((time.perf_counter() - start) * 1000, 2)
                ctx.logger.info(
                    "qwen3_hf.run.complete",
                    extra={
                        **run_meta,
                        "duration_ms": duration_ms,
                        "output_chars": len(accumulated),
                    },
                )

        return generator()

    reply = await _generate(instance, prompt, params, ctx.cancellation_token)
    payload = new_response(model_id, reply, request_id=ctx.request_id)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    ctx.logger.info(
        "qwen3_hf.run.complete",
        extra={
            **run_meta,
            "duration_ms": duration_ms,
            "output_chars": len(reply),
        },
    )
    return payload
