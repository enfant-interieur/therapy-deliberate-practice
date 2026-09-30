"""Normalize text-only Responses input before applying an adapter chat template."""

from __future__ import annotations

from typing import Any


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(_text(part) for part in content)
    if isinstance(content, dict):
        if content.get("type") in {"text", "input_text", "output_text"}:
            return str(content.get("text", ""))
        if "content" in content:
            return _text(content["content"])
    raise ValueError("The local language endpoint accepts text messages only.")


def prepare_chat_prompt(payload: dict | None, tokenizer: Any | None = None) -> str:
    payload = payload or {}
    messages = []
    if payload.get("instructions"):
        messages.append({"role": "system", "content": _text(payload["instructions"])})
    source = (
        payload.get("messages")
        or payload.get("input")
        or payload.get("prompt")
        or "You are a helpful assistant."
    )
    if isinstance(source, list):
        for entry in source:
            role = entry.get("role", "user") if isinstance(entry, dict) else "user"
            if role not in {"system", "developer", "user", "assistant"}:
                raise ValueError("Unsupported local message role.")
            messages.append({"role": "system" if role == "developer" else role, "content": _text(entry)})
    else:
        messages.append({"role": "user", "content": _text(source)})
    if tokenizer and getattr(tokenizer, "chat_template", None):
        return tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
        )
    return "\n".join(f"{message['role']}: {message['content']}" for message in messages)
