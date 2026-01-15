from __future__ import annotations

import copy
import json
import os
from dataclasses import dataclass
from typing import Any, Callable

from local_runtime.core.loader import LoadedModel
from local_runtime.helpers.responses_helpers import stream_events
from local_runtime.helpers.structured_output import (
    build_retry_feedback,
    build_schema_array_trimmer,
    build_structured_output_guard,
    build_diagnostics_defaults_fixer,
    extract_output_text,
    make_openai_strict_schema,
    parse_and_validate_structured_output,
)
from local_runtime.runtime_types import RunContext, RunRequest

MAX_SCHEMA_BYTES = int(os.getenv("LOCAL_RUNTIME_STRUCTURED_SCHEMA_MAX_BYTES", 256 * 1024))
DEFAULT_MAX_ATTEMPTS = int(os.getenv("LOCAL_RUNTIME_STRUCTURED_MAX_ATTEMPTS", "4") or "4")


def _coerce_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


@dataclass
class StructuredFormatConfig:
    schema_name: str
    schema: dict[str, Any]
    effective_schema: dict[str, Any]
    strict: bool


@dataclass
class StructuredEnforcementResult:
    canonical_text: str
    parsed: Any
    attempts: int


class StructuredOutputFailure(RuntimeError):
    pass


def detect_structured_mode(payload: dict | None) -> StructuredFormatConfig | None:
    if not isinstance(payload, dict):
        return None
    text_block = payload.get("text")
    if not isinstance(text_block, dict):
        return None
    fmt = text_block.get("format")
    if not isinstance(fmt, dict):
        return None
    if (fmt.get("type") or "").lower() != "json_schema":
        return None
    schema = fmt.get("schema")
    if not isinstance(schema, dict):
        raise ValueError("text.format.schema must be an object")
    schema_bytes = len(json.dumps(schema, ensure_ascii=False).encode("utf-8"))
    if schema_bytes > MAX_SCHEMA_BYTES:
        raise ValueError(f"text.format.schema exceeds limit of {MAX_SCHEMA_BYTES} bytes")
    strict = _coerce_bool(fmt.get("strict"), True)
    schema_name = fmt.get("name") or "StructuredOutput"
    effective_schema = make_openai_strict_schema(schema) if strict else copy.deepcopy(schema)
    return StructuredFormatConfig(schema_name=schema_name, schema=schema, effective_schema=effective_schema, strict=strict)


def normalize_messages(payload: dict) -> list[dict[str, Any]]:
    raw_messages = payload.get("messages")
    if isinstance(raw_messages, list) and raw_messages:
        normalized: list[dict[str, Any]] = []
        for msg in raw_messages:
            if not isinstance(msg, dict):
                continue
            role = str(msg.get("role", "user"))
            content = msg.get("content", "")
            if isinstance(content, str):
                normalized.append({"role": role, "content": content})
            elif isinstance(content, list):
                fragments: list[str] = []
                for chunk in content:
                    if isinstance(chunk, dict) and chunk.get("type") == "text" and "text" in chunk:
                        fragments.append(str(chunk["text"]))
                normalized.append({"role": role, "content": "\n".join(fragments)})
            else:
                normalized.append(
                    {"role": role, "content": json.dumps(content, ensure_ascii=False, separators=(",", ":"), sort_keys=True)}
                )
        return normalized
    normalized: list[dict[str, Any]] = []
    instructions = payload.get("instructions")
    if isinstance(instructions, str) and instructions.strip():
        normalized.append({"role": "system", "content": instructions.strip()})
    user_input = payload.get("input")
    user_content = ""
    if isinstance(user_input, str):
        user_content = user_input
    elif isinstance(user_input, list):
        fragments: list[str] = []
        for entry in user_input:
            if isinstance(entry, str):
                fragments.append(entry)
            elif isinstance(entry, dict):
                if entry.get("type") == "text" and "text" in entry:
                    fragments.append(str(entry["text"]))
                elif entry.get("content"):
                    fragments.extend(str(chunk.get("text", "")) for chunk in entry["content"] if isinstance(chunk, dict))
        user_content = "\n".join(fragment for fragment in fragments if fragment)
    elif user_input is not None:
        user_content = json.dumps(user_input, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    if not user_content:
        prompt = payload.get("prompt")
        if isinstance(prompt, str) and prompt.strip():
            user_content = prompt.strip()
    if not user_content:
        user_content = "Respond with JSON that matches the provided schema."
    normalized.append({"role": "user", "content": user_content})
    return normalized


def _clean_snippet(text: str) -> str:
    snippet = (text or "").strip().replace("\n", " ")
    if len(snippet) > 400:
        snippet = snippet[:400].rstrip() + "..."
    return snippet


def _apply_retry_sampling(payload: dict) -> None:
    try:
        temperature = float(payload.get("temperature", 0.2))
    except (TypeError, ValueError):
        temperature = 0.2
    payload["temperature"] = min(temperature, 0.2)
    try:
        top_p = float(payload.get("top_p", 0.5))
    except (TypeError, ValueError):
        top_p = 0.5
    payload["top_p"] = min(top_p, 0.5)


class StructuredOutputEnforcer:
    def __init__(self, *, selected: LoadedModel, ctx: RunContext, config: StructuredFormatConfig, request_id: str):
        self.selected = selected
        self.ctx = ctx
        self.config = config
        self.logger = ctx.logger
        self.request_id = request_id
        self.max_attempts = max(1, DEFAULT_MAX_ATTEMPTS)
        self.auto_fixers = self._build_auto_fixers()

    def _build_auto_fixers(self) -> list[Callable[[Any], bool]]:
        provider_defaults = {
            "stt": {"kind": "local", "model": os.getenv("LOCAL_RUNTIME_STT_MODEL", "local//stt")},
            "llm": {"kind": "local", "model": self.selected.spec.id},
        }
        timing_defaults = {"stt": 0, "llm": 0, "total": 0}
        fixers: list[Callable[[Any], bool]] = [build_schema_array_trimmer(self.config.schema)]
        schema_props = {}
        if isinstance(self.config.schema, dict):
            schema_props = self.config.schema.get("properties") or {}
        if isinstance(schema_props, dict) and "diagnostics" in schema_props:
            fixers.append(
                build_diagnostics_defaults_fixer(provider_defaults=provider_defaults, timing_defaults=timing_defaults)
            )
        return fixers

    async def run(self, payload: dict) -> StructuredEnforcementResult:
        base_payload = copy.deepcopy(payload)
        normalized_messages = normalize_messages(base_payload)
        guard_message = {"role": "system", "content": build_structured_output_guard(self.config.schema_name, self.config.effective_schema)}
        base_messages = normalized_messages + [guard_message]
        retry_messages: list[dict[str, str]] = []
        last_error = "structured_output_failed"
        for attempt in range(1, self.max_attempts + 1):
            attempt_messages = [copy.deepcopy(msg) for msg in base_messages + retry_messages]
            attempt_payload = copy.deepcopy(base_payload)
            attempt_payload["messages"] = attempt_messages
            attempt_payload["stream"] = False
            if attempt >= 2:
                _apply_retry_sampling(attempt_payload)
            run_request = RunRequest(endpoint="responses", model=self.selected.spec.id, json=attempt_payload, stream=False)
            self.logger.info(
                "structured_output.attempt",
                extra={"request_id": self.request_id, "model_id": self.selected.spec.id, "attempt": attempt},
            )
            result = await self.selected.module.run(run_request, self.ctx)
            output_text = extract_output_text(result)
            if not output_text:
                last_error = "missing_output_text"
            else:
                try:
                    canonical, parsed = parse_and_validate_structured_output(
                        output_text, self.config.effective_schema, auto_fixers=self.auto_fixers
                    )
                    self.logger.info(
                        "structured_output.valid",
                        extra={
                            "request_id": self.request_id,
                            "model_id": self.selected.spec.id,
                            "attempt": attempt,
                            "output_preview": canonical[:120],
                        },
                    )
                    return StructuredEnforcementResult(canonical_text=canonical, parsed=parsed, attempts=attempt)
                except ValueError as exc:
                    last_error = str(exc)
            if attempt >= self.max_attempts:
                break
            snippet = _clean_snippet(output_text or "")
            retry_feedback = build_retry_feedback(attempt, last_error, snippet)
            retry_messages.append({"role": "system", "content": retry_feedback})
            self.logger.warning(
                "structured_output.retry",
                extra={
                    "request_id": self.request_id,
                    "model_id": self.selected.spec.id,
                    "attempt": attempt,
                    "reason": last_error,
                    "snippet": snippet,
                },
            )
        raise StructuredOutputFailure(last_error)


async def stream_validated_json(model_id: str, text: str, request_id: str | None = None):
    for event, data in stream_events(model_id, text, request_id=request_id):
        yield {"event": event, "data": data}
