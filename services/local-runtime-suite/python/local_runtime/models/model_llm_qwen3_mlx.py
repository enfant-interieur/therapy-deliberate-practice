from __future__ import annotations

import asyncio
import os
import threading
import time
from typing import Any, AsyncIterator

from local_runtime.helpers.responses_helpers import new_response
from local_runtime.runtime_types import RunContext, RunRequest

SPEC = {
    "id": "local//llm/qwen3-mlx",
    "kind": "llm",
    "display": {
        "title": "Qwen3 MLX",
        "description": "Local Qwen3 inference via MLX on Apple Silicon.",
        "tags": ["qwen", "mlx", "local"],
        "icon": "cpu",
    },
    "compat": {
        "platforms": ["darwin-arm64"],
        "acceleration": ["metal"],
        "priority": 120,
        "requires_ram_gb": 8,
        "requires_vram_gb": 0,
        "disk_gb": 6,
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
        "model_ref": "Qwen/Qwen3-4B-MLX-4bit",
        "revision": None,
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
        "pip": ["mlx-lm>=0.25.2"],
        "system": [],
        "notes": "Requires Apple Silicon with MLX support.",
    },
}

DEFAULT_MAX_TOKENS = int(os.getenv("LOCAL_RUNTIME_QWEN_MAX_TOKENS", SPEC["limits"]["max_output_tokens_default"]))
DEFAULT_TEMPERATURE = float(os.getenv("LOCAL_RUNTIME_QWEN_TEMPERATURE", "0.7"))
DEFAULT_TOP_P = float(os.getenv("LOCAL_RUNTIME_QWEN_TOP_P", "0.9"))
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
                    fragments.extend(str(chunk.get("text", "")) for chunk in entry["content"] if isinstance(chunk, dict))
        if fragments:
            return "\n".join(fragments)
    if isinstance(payload.get("input"), str):
        return payload["input"]
    return str(payload.get("prompt") or "You are a helpful assistant.")


def _generation_params(payload: dict | None) -> dict[str, Any]:
    payload = payload or {}
    temperature = payload.get("temperature")
    top_p = payload.get("top_p")
    repetition_penalty = payload.get("repetition_penalty")
    return {
        "max_tokens": int(payload.get("max_output_tokens") or DEFAULT_MAX_TOKENS),
        "temperature": float(temperature if temperature is not None else DEFAULT_TEMPERATURE),
        "top_p": float(top_p if top_p is not None else DEFAULT_TOP_P),
        "repetition_penalty": float(repetition_penalty if repetition_penalty is not None else DEFAULT_REPETITION_PENALTY),
    }


def _build_sampling_components(params: dict[str, Any]):
    from mlx_lm.sample_utils import make_logits_processors, make_sampler  # type: ignore

    sampler = make_sampler(temp=params["temperature"], top_p=params["top_p"])
    logits_processors = make_logits_processors(repetition_penalty=params.get("repetition_penalty"))
    return sampler, logits_processors


def _extract_response_text(response: Any) -> str:
    text = getattr(response, "text", None)
    if isinstance(text, str):
        return text
    return str(response)


async def _generate_text(instance: dict, prompt: str, params: dict[str, Any]) -> str:
    def _invoke() -> str:
        from mlx_lm import generate  # type: ignore

        sampler, logits_processors = _build_sampling_components(params)
        return generate(
            instance["model"],
            instance["tokenizer"],
            prompt=prompt,
            max_tokens=params["max_tokens"],
            sampler=sampler,
            logits_processors=logits_processors,
        )

    return await asyncio.to_thread(_invoke)


async def _generate_stream(instance: dict, prompt: str, params: dict[str, Any]) -> AsyncIterator[str]:
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str | Exception | None] = asyncio.Queue()

    def _reader() -> None:
        from mlx_lm import stream_generate  # type: ignore

        try:
            sampler, logits_processors = _build_sampling_components(params)
            prev_text = ""
            for response in stream_generate(
                instance["model"],
                instance["tokenizer"],
                prompt=prompt,
                max_tokens=params["max_tokens"],
                sampler=sampler,
                logits_processors=logits_processors,
            ):
                text = _extract_response_text(response)
                delta = text
                if text.startswith(prev_text):
                    delta = text[len(prev_text) :]
                prev_text = text
                if delta:
                    loop.call_soon_threadsafe(queue.put_nowait, delta)
        except Exception as exc:  # pragma: no cover - propagate to async loop
            loop.call_soon_threadsafe(queue.put_nowait, exc)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=_reader, daemon=True).start()

    while True:
        item = await queue.get()
        if item is None:
            break
        if isinstance(item, Exception):
            raise item
        yield item


def load(ctx: RunContext) -> dict[str, Any]:
    try:
        from mlx_lm import load as mlx_load  # type: ignore
    except ImportError as exc:
        raise RuntimeError("mlx-lm is required for Qwen3 MLX. Install with `pip install mlx-lm`.") from exc
    model_ref = os.getenv("LOCAL_RUNTIME_QWEN3_MLX_MODEL", SPEC["backend"]["model_ref"])
    ctx.logger.info("qwen3_mlx.load", extra={"model_id": SPEC["id"], "model_ref": model_ref})
    model, tokenizer = mlx_load(model_ref)
    return {"model": model, "tokenizer": tokenizer, "model_ref": model_ref}


def warmup(instance: dict[str, Any], ctx: RunContext) -> None:
    prompt = "You are a helpful assistant. Say hello."
    ctx.logger.info("qwen3_mlx.warmup.start", extra={"model_id": SPEC["id"], "prompt": prompt})
    start = time.perf_counter()
    try:
        from mlx_lm import generate  # type: ignore

        warmup_params = {
            "max_tokens": 32,
            "temperature": 0.6,
            "top_p": 0.9,
            "repetition_penalty": DEFAULT_REPETITION_PENALTY,
        }
        sampler, logits_processors = _build_sampling_components(warmup_params)
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
        ctx.logger.exception("qwen3_mlx.warmup.error", extra={"model_id": SPEC["id"], "error": str(exc), "duration_ms": duration_ms})


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
        "prompt_preview": prompt[:120],
    }
    ctx.logger.info("qwen3_mlx.run.start", extra=run_meta)
    ctx.logger.info("qwen3_mlx.run.input", extra={**run_meta, "prompt": prompt})
    start = time.perf_counter()

    if req.stream:

        async def generator() -> AsyncIterator[dict]:
            response = new_response(model_id, "", request_id=ctx.request_id)
            yield {"event": "response.created", "data": response}
            accumulated = ""
            try:
                async for chunk in _generate_stream(instance, prompt, params):
                    if not chunk:
                        continue
                    accumulated += chunk
                    yield {"event": "response.output_text.delta", "data": {"id": response["id"], "delta": chunk}}
                response["output_text"] = accumulated
                response["output"][0]["content"][0]["text"] = accumulated
                yield {"event": "response.output_text.done", "data": {"id": response["id"], "text": accumulated}}
                yield {"event": "response.completed", "data": response}
            finally:
                ctx.logger.info("qwen3_mlx.run.output", extra={**run_meta, "text": accumulated})
                duration_ms = round((time.perf_counter() - start) * 1000, 2)
                ctx.logger.info(
                    "qwen3_mlx.run.complete",
                    extra={**run_meta, "duration_ms": duration_ms, "output_chars": len(accumulated), "output_preview": accumulated[:120]},
                )

        return generator()

    reply = await _generate_text(instance, prompt, params)
    ctx.logger.info("qwen3_mlx.run.output", extra={**run_meta, "text": reply})
    payload = new_response(model_id, reply, request_id=ctx.request_id)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    ctx.logger.info(
        "qwen3_mlx.run.complete",
        extra={**run_meta, "duration_ms": duration_ms, "output_chars": len(reply), "output_preview": reply[:120]},
    )
    return payload
