from __future__ import annotations

import asyncio
import os
import threading
import time
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

from local_runtime.cancellation import CancellationToken, acquire_model_lock
from local_runtime.helpers.responses_helpers import new_response
from local_runtime.runtime_types import RunContext, RunRequest

SPEC = {
    "id": "local//llm/qwen3-mlx",
    "kind": "llm",
    "display": {
        "title": "Qwen3 4B Instruct MLX",
        "description": "Qwen3 4B Instruct 2507, quantized for fast local MLX inference.",
        "tags": ["qwen", "mlx", "local"],
        "icon": "cpu",
    },
    "compat": {
        "platforms": ["darwin-arm64"],
        "acceleration": ["metal"],
        "priority": 120,
        "requires_ram_gb": 8,
        "requires_vram_gb": 0,
        "disk_gb": 3,
    },
    "api": {
        "endpoint": "responses",
        "advertised_model_name": "qwen3-mlx",
        "supports_stream": True,
    },
    "limits": {
        "timeout_sec": 300,
        "concurrency": 1,
        "max_input_mb": 25,
        "max_output_tokens_default": 2048,
    },
    "backend": {
        "provider": "mlx",
        "model_ref": "mlx-community/Qwen3-4B-Instruct-2507-4bit",
        "revision": "50d427756c6b1b2fe0c0a10f67fbda1fc8e82c1b",
        "device_hint": "metal",
        "extra": {},
    },
    "execution": {
        "mode": "inprocess",
        "warmup_on_start": False,
    },
    "launch": {
        "enabled": False,
        "type": "command",
        "explain": "MLX runs in-process.",
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
        "python_extras": ["mlx"],
        "pip": ["mlx-lm==0.31.3"],
        "system": [],
        "notes": "Requires Apple Silicon with MLX support.",
    },
}

DEFAULT_MAX_TOKENS = int(
    os.getenv("LOCAL_RUNTIME_QWEN_MAX_TOKENS", SPEC["limits"]["max_output_tokens_default"])
)
DEFAULT_TEMPERATURE = float(os.getenv("LOCAL_RUNTIME_QWEN_TEMPERATURE", "0.7"))
DEFAULT_TOP_P = float(os.getenv("LOCAL_RUNTIME_QWEN_TOP_P", "0.8"))
DEFAULT_TOP_K = int(os.getenv("LOCAL_RUNTIME_QWEN_TOP_K", "20"))
DEFAULT_REPETITION_PENALTY = float(os.getenv("LOCAL_RUNTIME_QWEN_REPETITION_PENALTY", "1.0"))


def _prepare_prompt(payload: dict | None, tokenizer: Any | None = None) -> str:
    if not payload:
        return "You are a helpful assistant."
    if payload.get("messages"):
        messages = payload["messages"]
        if tokenizer and getattr(tokenizer, "chat_template", None):
            return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        return "\n".join(f"{msg.get('role', 'user')}: {msg.get('content', '')}" for msg in messages)
    if isinstance(payload.get("input"), list):
        fragments: list[str] = []
        for entry in payload["input"]:
            if isinstance(entry, str):
                fragments.append(entry)
            elif isinstance(entry, dict):
                if entry.get("type") == "text" and "text" in entry:
                    fragments.append(str(entry["text"]))
                elif entry.get("content"):
                    fragments.extend(
                        str(chunk.get("text", "")) for chunk in entry["content"] if isinstance(chunk, dict)
                    )
        if fragments:
            return "\n".join(fragments)
    if isinstance(payload.get("input"), str):
        return payload["input"]
    return str(payload.get("prompt") or "You are a helpful assistant.")


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
        "max_tokens": max(
            1,
            min(
                requested_tokens,
                int(SPEC["limits"]["max_output_tokens_default"]) * 4,
            ),
        ),
        "temperature": _bounded_float(payload.get("temperature"), DEFAULT_TEMPERATURE, 0.0, 2.0),
        "top_p": _bounded_float(payload.get("top_p"), DEFAULT_TOP_P, 0.01, 1.0),
        "top_k": max(1, min(requested_top_k, 100)),
        "repetition_penalty": _bounded_float(
            payload.get("repetition_penalty"),
            DEFAULT_REPETITION_PENALTY,
            0.1,
            2.0,
        ),
    }


def _build_sampling_components(params: dict[str, Any]):
    from mlx_lm.sample_utils import make_logits_processors, make_sampler  # type: ignore

    sampler = make_sampler(
        temp=params["temperature"],
        top_p=params["top_p"],
        top_k=params["top_k"],
    )
    logits_processors = make_logits_processors(repetition_penalty=params.get("repetition_penalty"))
    return sampler, logits_processors


def _extract_response_text(response: Any) -> str:
    text = getattr(response, "text", None)
    if isinstance(text, str):
        return text
    return str(response)


def _iterate_generation(
    instance: dict,
    prompt: str,
    params: dict[str, Any],
    token: CancellationToken | None,
    on_lock_acquired: Callable[[], None] | None = None,
):
    from mlx_lm import stream_generate  # type: ignore

    if token is not None:
        token.raise_if_cancelled()
    sampler, logits_processors = _build_sampling_components(params)
    previous_text = ""
    with acquire_model_lock(instance["lock"], token):
        if on_lock_acquired is not None:
            on_lock_acquired()
        for response in stream_generate(
            instance["model"],
            instance["tokenizer"],
            prompt=prompt,
            max_tokens=params["max_tokens"],
            sampler=sampler,
            logits_processors=logits_processors,
        ):
            if token is not None:
                token.raise_if_cancelled()
            text = _extract_response_text(response)
            delta = text.removeprefix(previous_text)
            previous_text = text
            if delta:
                yield delta
    if token is not None:
        token.raise_if_cancelled()


async def _generate_text(
    instance: dict,
    prompt: str,
    params: dict[str, Any],
    token: CancellationToken | None = None,
) -> str:
    def _invoke() -> str:
        return "".join(_iterate_generation(instance, prompt, params, token))

    return await asyncio.to_thread(_invoke)


async def _generate_stream(
    instance: dict,
    prompt: str,
    params: dict[str, Any],
    token: CancellationToken | None = None,
) -> AsyncIterator[str]:
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str | Exception | None] = asyncio.Queue()
    ready: asyncio.Future[None] = loop.create_future()

    def _mark_ready() -> None:
        if not ready.done():
            ready.set_result(None)

    def _mark_failed(exc: Exception) -> None:
        if not ready.done():
            ready.set_exception(exc)

    def _reader() -> None:
        try:
            for delta in _iterate_generation(
                instance,
                prompt,
                params,
                token,
                lambda: loop.call_soon_threadsafe(_mark_ready),
            ):
                loop.call_soon_threadsafe(queue.put_nowait, delta)
        except Exception as exc:  # noqa: BLE001 - propagate arbitrary backend errors to the async caller
            loop.call_soon_threadsafe(_mark_failed, exc)
            loop.call_soon_threadsafe(queue.put_nowait, exc)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=_reader, daemon=True).start()
    await ready

    async def _events() -> AsyncIterator[str]:
        completed = False
        try:
            while True:
                item = await queue.get()
                if item is None:
                    completed = True
                    break
                if isinstance(item, Exception):
                    raise item
                yield item
        finally:
            if not completed and token is not None:
                token.cancel()

    return _events()


def load(ctx: RunContext) -> dict[str, Any]:
    try:
        from mlx_lm import load as mlx_load  # type: ignore
    except ImportError as exc:
        raise RuntimeError("mlx-lm is required for Qwen3 MLX. Install with `pip install mlx-lm`.") from exc
    from huggingface_hub import snapshot_download

    model_ref = os.getenv("LOCAL_RUNTIME_QWEN3_MLX_MODEL", SPEC["backend"]["model_ref"])
    revision = os.getenv("LOCAL_RUNTIME_QWEN3_MLX_REVISION") or SPEC["backend"]["revision"]
    local_path = Path(model_ref).expanduser()
    resolved_model_ref = (
        str(local_path.resolve())
        if local_path.exists()
        else snapshot_download(
            repo_id=model_ref,
            revision=revision,
            cache_dir=ctx.cache_dir,
        )
    )
    ctx.logger.info(
        "qwen3_mlx.load",
        extra={"model_id": SPEC["id"], "model_ref": model_ref, "revision": revision},
    )
    model, tokenizer = mlx_load(resolved_model_ref, revision=revision)
    return {
        "model": model,
        "tokenizer": tokenizer,
        "model_ref": model_ref,
        "revision": revision,
        "lock": threading.Lock(),
    }


def warmup(instance: dict[str, Any], ctx: RunContext) -> None:
    prompt = "You are a helpful assistant. Say hello."
    ctx.logger.info("qwen3_mlx.warmup.start", extra={"model_id": SPEC["id"]})
    start = time.perf_counter()
    try:
        from mlx_lm import generate  # type: ignore

        warmup_params = {
            "max_tokens": 32,
            "temperature": 0.6,
            "top_p": DEFAULT_TOP_P,
            "top_k": DEFAULT_TOP_K,
            "repetition_penalty": DEFAULT_REPETITION_PENALTY,
        }
        sampler, logits_processors = _build_sampling_components(warmup_params)
        with instance["lock"]:
            generate(
                instance["model"],
                instance["tokenizer"],
                prompt=prompt,
                max_tokens=warmup_params["max_tokens"],
                sampler=sampler,
                logits_processors=logits_processors,
            )
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        ctx.logger.info("qwen3_mlx.warmup.done", extra={"model_id": SPEC["id"], "duration_ms": duration_ms})
    except Exception as exc:
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        ctx.logger.exception(
            "qwen3_mlx.warmup.error",
            extra={"model_id": SPEC["id"], "error": str(exc), "duration_ms": duration_ms},
        )


async def run(req: RunRequest, ctx: RunContext):
    payload = req.payload or {}
    model_id = req.model or SPEC["id"]
    instance = await ctx.registry.ensure_instance(model_id, ctx)
    if not instance:
        raise RuntimeError("Qwen3 MLX model not initialized.")
    prompt = _prepare_prompt(payload, tokenizer=instance.get("tokenizer"))
    params = _generation_params(payload)
    run_meta = {
        "model_id": model_id,
        "stream": bool(req.stream),
        "prompt_chars": len(prompt),
    }
    ctx.logger.info("qwen3_mlx.run.start", extra=run_meta)
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
                    "qwen3_mlx.run.complete",
                    extra={
                        **run_meta,
                        "duration_ms": duration_ms,
                        "output_chars": len(accumulated),
                    },
                )

        return generator()

    reply = await _generate_text(instance, prompt, params, ctx.cancellation_token)
    payload = new_response(model_id, reply, request_id=ctx.request_id)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    ctx.logger.info(
        "qwen3_mlx.run.complete",
        extra={
            **run_meta,
            "duration_ms": duration_ms,
            "output_chars": len(reply),
        },
    )
    return payload
