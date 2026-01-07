from __future__ import annotations

import copy
import json
import re
from functools import lru_cache
from typing import Any

try:  # pragma: no cover - import guard exercised in tests
    from jsonschema import Draft7Validator
except Exception:  # pragma: no cover
    Draft7Validator = None  # type: ignore

THINKING_PATTERN = re.compile(r"<\s*(thinking|think)\s*>(.*?)<\s*/\s*\1\s*>", re.IGNORECASE | re.DOTALL)
CODE_FENCE_START = re.compile(r"^```[a-z0-9_-]*\s*", re.IGNORECASE)
CODE_FENCE_END = re.compile(r"\s*```$", re.IGNORECASE)
TRAILING_COMMA_PATTERN = re.compile(r",\s*(?=[}\]])")


def _strip_code_fences(text: str) -> tuple[str, bool]:
    trimmed = text.strip()
    changed = False
    if CODE_FENCE_START.match(trimmed):
        trimmed = CODE_FENCE_START.sub("", trimmed, count=1)
        changed = True
    if CODE_FENCE_END.search(trimmed):
        trimmed = CODE_FENCE_END.sub("", trimmed, count=1)
        changed = True
    return trimmed.strip(), changed


def strip_thinking(text: str) -> str:
    if not text:
        return ""
    cleaned = THINKING_PATTERN.sub("", text)
    cleaned = cleaned.strip()
    cleaned, _ = _strip_code_fences(cleaned)
    return cleaned.strip()


def extract_json_region(text: str) -> str:
    if not text:
        return ""
    candidate = text.strip()
    if not candidate:
        return ""
    if candidate[0] in "{[" and candidate[-1] in "]}":
        return candidate
    segments: list[str] = []
    first_obj = candidate.find("{")
    last_obj = candidate.rfind("}")
    if first_obj != -1 and last_obj > first_obj:
        segments.append(candidate[first_obj : last_obj + 1])
    first_arr = candidate.find("[")
    last_arr = candidate.rfind("]")
    if first_arr != -1 and last_arr > first_arr:
        segments.append(candidate[first_arr : last_arr + 1])
    if segments:
        return max(segments, key=len)
    return candidate


def repair_json_minimal(text: str) -> str | None:
    if not text:
        return None
    trimmed = text.strip()
    unfenced, unfenced_changed = _strip_code_fences(trimmed)
    repaired = TRAILING_COMMA_PATTERN.sub("", unfenced)
    if repaired != trimmed or unfenced_changed:
        return repaired.strip()
    return None


def extract_output_text(payload: Any) -> str | None:
    if payload is None:
        return None
    if isinstance(payload, bytes):
        return payload.decode("utf-8", errors="ignore")
    if isinstance(payload, str):
        return payload
    if isinstance(payload, dict):
        text_value = payload.get("output_text")
        if isinstance(text_value, str) and text_value.strip():
            return text_value
        output = payload.get("output")
        if isinstance(output, list):
            for entry in output:
                if not isinstance(entry, dict):
                    continue
                content = entry.get("content")
                if not isinstance(content, list):
                    continue
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "output_text":
                        text = item.get("text")
                        if isinstance(text, str) and text.strip():
                            return text
    return None


def postprocess_to_json_text(raw_text: str) -> tuple[str, Any]:
    candidate = strip_thinking(raw_text)
    candidate = extract_json_region(candidate)
    if not candidate:
        raise ValueError("invalid_json: empty response")
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        repaired = repair_json_minimal(candidate)
        if not repaired:
            raise ValueError("invalid_json: parse_failed")
        try:
            parsed = json.loads(repaired)
        except json.JSONDecodeError as exc:  # pragma: no cover - defensive
            raise ValueError("invalid_json: parse_failed") from exc
    canonical = json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))
    return canonical, parsed


def _deepcopy_schema(schema: dict) -> dict:
    return copy.deepcopy(schema)


def make_openai_strict_schema(schema: dict) -> dict:
    def _apply(node: Any) -> Any:
        if isinstance(node, dict):
            node = {k: _apply(v) for k, v in node.items()}
            props = node.get("properties")
            if isinstance(props, dict):
                node["properties"] = {k: _apply(v) for k, v in props.items()}
                keys = list(node["properties"].keys())
                if keys:
                    required = node.get("required")
                    ordered = list(required) if isinstance(required, list) else []
                    for key in keys:
                        if key not in ordered:
                            ordered.append(key)
                    node["required"] = ordered
                node.setdefault("additionalProperties", False)
            items = node.get("items")
            if isinstance(items, dict):
                node["items"] = _apply(items)
            for branch_key in ("anyOf", "oneOf", "allOf"):
                branch = node.get(branch_key)
                if isinstance(branch, list):
                    node[branch_key] = [_apply(item) for item in branch]
        elif isinstance(node, list):
            node = [_apply(item) for item in node]
        return node

    return _apply(_deepcopy_schema(schema))


@lru_cache(maxsize=64)
def _get_validator(schema_key: str):
    if Draft7Validator is None:
        raise RuntimeError("jsonschema is required for structured outputs. Install jsonschema>=4.22.0")
    schema = json.loads(schema_key)
    return Draft7Validator(schema)


def validate_against_schema(obj: Any, schema: dict) -> list[str]:
    schema_json = json.dumps(schema, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    validator = _get_validator(schema_json)
    errors: list[str] = []
    for error in validator.iter_errors(obj):
        path = "$"
        for elem in error.absolute_path:
            if isinstance(elem, int):
                path += f"[{elem}]"
            else:
                path += f"[\"{elem}\"]"
        errors.append(f"{path}: {error.message}")
        if len(errors) >= 25:
            break
    return errors


def parse_and_validate_structured_output(raw_text: str, schema: dict) -> tuple[str, Any]:
    canonical, parsed = postprocess_to_json_text(raw_text)
    violations = validate_against_schema(parsed, schema)
    if violations:
        raise ValueError(f"schema_validation_failed: {'; '.join(violations)}")
    return canonical, parsed


def build_structured_output_guard(schema_name: str, effective_schema: dict) -> str:
    schema_json = json.dumps(effective_schema, ensure_ascii=False, separators=(",", ":"))
    return (
        "STRUCTURED OUTPUT MODE ACTIVE.\n"
        "Return ONLY valid JSON that matches the schema below.\n"
        "No markdown. No commentary. No code fences.\n"
        "Do not add any keys that are not defined in the schema.\n"
        f"SCHEMA NAME: {schema_name}\n"
        f"SCHEMA: {schema_json}"
    )


def build_retry_feedback(attempt: int, reason: str, bad_snippet: str) -> str:
    snippet = bad_snippet.strip().replace("\n", " ")
    if len(snippet) > 400:
        snippet = snippet[:400].rstrip() + "..."
    reason = reason.strip() or "invalid output"
    return (
        f"Attempt {attempt} produced invalid JSON ({reason}). "
        "Respond again with JSON only, matching the schema exactly. "
        "No comments, no markdown, no extra keys. "
        f"Problem snippet: {snippet}"
    )
