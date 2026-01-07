from __future__ import annotations

import asyncio
import os
import threading
import time
from typing import Any, AsyncIterator

import torch
from transformers import AutoModel, AutoTokenizer, TextIteratorStreamer

from local_runtime.helpers.responses_helpers import new_response
from local_runtime.runtime_types import RunContext, RunRequest

SPEC = {
    "id": "local//llm/qwen3-hf",
    "kind": "llm",
    "display": {
        "title": "Qwen3 HF",
        "description": "Qwen3-4B inference via transformers AutoModel on Unsloth's GGUF build.",
        "tags": ["qwen", "hf", "local"],
        "icon": "bolt",
    },
    "compat": {
        "platforms": ["darwin-x64", "windows-x64", "linux-x64"],
        "acceleration": ["cpu", "cuda"],
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
        "model_ref": "unsloth/Qwen3-4B-Instruct-2507-GGUF",
        "revision": None,
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
        "pip": ["transformers>=4.52", "torch>=2.3"],
        "system": [],
        "notes": "Requires transformers AutoModel support for Qwen3 GGUF.",
    },
}

DEFAULT_MAX_TOKENS = int(os.getenv("LOCAL_RUNTIME_QWEN_HF_MAX_TOKENS", SPEC["limits"]["max_output_tokens_default"]))
DEFAULT_TEMPERATURE = float(os.getenv("LOCAL_RUNTIME_QWEN_HF_TEMPERATURE", "0.7"))
DEFAULT_TOP_P = float(os.getenv("LOCAL_RUNTIME_QWEN_HF_TOP_P", "0.9"))


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
            elif isinstance(entry, dict):
                if entry.get("type") == "text" and "text" in entry:
                    parts.append(str(entry["text"]))
        if parts:
            return "\n".join(parts)
    if isinstance(payload.get("input"), str):
        return payload["input"]
    if payload.get("prompt"):
        return str(payload["prompt"])
    return "You are a helpful assistant."


def _generation_params(payload: dict | None) -> dict[str, Any]:
    if not payload:
        return {"max_new_tokens": DEFAULT_MAX_TOKENS, "temperature": DEFAULT_TEMPERATURE, "top_p": DEFAULT_TOP_P}
    return {
        "max_new_tokens": int(payload.get("max_output_tokens") or DEFAULT_MAX_TOKENS),
        "temperature": float(payload.get("temperature") or DEFAULT_TEMPERATURE),
        "top_p": float(payload.get("top_p") or DEFAULT_TOP_P),
    }


def _select_device() -> str:
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
    model_ref = os.getenv("LOCAL_RUNTIME_QWEN3_HF_MODEL", SPEC["backend"]["model_ref"])
    ctx.logger.info("qwen3_hf.load.start", extra={"model_id": SPEC["id"], "repo": model_ref})
    try:
        tokenizer = AutoTokenizer.from_pretrained(model_ref, trust_remote_code=True)
        model = AutoModel.from_pretrained(
            model_ref,
            trust_remote_code=True,
            torch_dtype="auto",
        )
    except Exception as exc:  # pragma: no cover - surfaced via startup logs
        raise RuntimeError(
            "Failed to load transformers weights for Qwen3 HF. Ensure the repo contains compatible files."
        ) from exc
    device = _select_device()
    model.to(device)
    model.eval()
    ctx.logger.info("qwen3_hf.load.ready", extra={"model_id": SPEC["id"], "device": device})
    return {"model": model, "tokenizer": tokenizer, "device": device, "lock": threading.Lock()}


def warmup(instance: dict[str, Any], ctx: RunContext) -> None:
    tokenizer = instance["tokenizer"]
    model = instance["model"]
    device = instance["device"]
    prompt = "Hello from warmup."
    ctx.logger.info("qwen3_hf.warmup.start", extra={"model_id": SPEC["id"], "prompt": prompt, "device": device})
    start = time.perf_counter()

    def _invoke() -> None:
        with torch.inference_mode():
            prompt_inputs = tokenizer(prompt, return_tensors="pt").to(device)
            with instance["lock"]:
                model.generate(**prompt_inputs, max_new_tokens=8)

    try:
        _invoke()
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        ctx.logger.info("qwen3_hf.warmup.done", extra={"model_id": SPEC["id"], "device": device, "duration_ms": duration_ms})
    except Exception as exc:
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        ctx.logger.exception(
            "qwen3_hf.warmup.error",
            extra={"model_id": SPEC["id"], "device": device, "duration_ms": duration_ms, "error": str(exc)},
        )


async def _generate(instance: dict[str, Any], prompt: str, params: dict[str, Any]) -> str:
    tokenizer = instance["tokenizer"]
    model = instance["model"]
    device = instance["device"]

    def _invoke() -> str:
        inputs = tokenizer(prompt, return_tensors="pt").to(device)
        with torch.inference_mode():
            with instance["lock"]:
                output = model.generate(
                    **inputs,
                    max_new_tokens=params["max_new_tokens"],
                    temperature=params["temperature"],
                    top_p=params["top_p"],
                )
        generated = output[0][inputs.input_ids.shape[-1] :]
        return tokenizer.decode(generated, skip_special_tokens=True)

    return await asyncio.to_thread(_invoke)


async def _generate_stream(instance: dict[str, Any], prompt: str, params: dict[str, Any]) -> AsyncIterator[str]:
    tokenizer = instance["tokenizer"]
    model = instance["model"]
    device = instance["device"]
    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str | Exception | None] = asyncio.Queue()

    def _worker() -> None:
        try:
            inputs = tokenizer(prompt, return_tensors="pt").to(device)
            generation_kwargs = dict(
                **inputs,
                max_new_tokens=params["max_new_tokens"],
                temperature=params["temperature"],
                top_p=params["top_p"],
                streamer=streamer,
            )
            with torch.inference_mode():
                with instance["lock"]:
                    model.generate(**generation_kwargs)
        except Exception as exc:
            loop.call_soon_threadsafe(queue.put_nowait, exc)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    def _drain_streamer() -> None:
        try:
            for token in streamer:
                loop.call_soon_threadsafe(queue.put_nowait, token)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=_worker, daemon=True).start()
    threading.Thread(target=_drain_streamer, daemon=True).start()

    pending_eof = 2
    while pending_eof:
        item = await queue.get()
        if item is None:
            pending_eof -= 1
            continue
        if isinstance(item, Exception):
            raise item
        yield item


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
        "prompt_preview": prompt[:120],
    }
    ctx.logger.info("qwen3_hf.run.start", extra=run_meta)
    ctx.logger.info("qwen3_hf.run.input", extra={**run_meta, "prompt": prompt})
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
                ctx.logger.info("qwen3_hf.run.output", extra={**run_meta, "text": accumulated})
                duration_ms = round((time.perf_counter() - start) * 1000, 2)
                ctx.logger.info(
                    "qwen3_hf.run.complete",
                    extra={**run_meta, "duration_ms": duration_ms, "output_chars": len(accumulated), "output_preview": accumulated[:120]},
                )

        return generator()

    reply = await _generate(instance, prompt, params)
    ctx.logger.info("qwen3_hf.run.output", extra={**run_meta, "text": reply})
    payload = new_response(model_id, reply, request_id=ctx.request_id)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    ctx.logger.info(
        "qwen3_hf.run.complete",
        extra={**run_meta, "duration_ms": duration_ms, "output_chars": len(reply), "output_preview": reply[:120]},
    )
    return payload
