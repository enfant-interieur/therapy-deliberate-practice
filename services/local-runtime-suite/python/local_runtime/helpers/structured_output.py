from __future__ import annotations

import copy
import json
import re
from functools import lru_cache
from typing import Any, Callable

try:  # pragma: no cover - import guard exercised in tests
    from jsonschema import Draft7Validator
except Exception:  # pragma: no cover
    Draft7Validator = None  # type: ignore

THINKING_PATTERN = re.compile(r"<\s*(thinking|think)\s*>(.*?)<\s*/\s*\1\s*>", re.IGNORECASE | re.DOTALL)
CODE_FENCE_START = re.compile(r"^```[a-z0-9_-]*\s*", re.IGNORECASE)
CODE_FENCE_END = re.compile(r"\s*```$", re.IGNORECASE)
TRAILING_COMMA_PATTERN = re.compile(r",\s*(?=[}\]])")
_WILDCARD = object()
_OPEN_TO_CLOSE = {"{": "}", "[": "]"}
_CLOSE_TO_OPEN = {"}": "{", "]": "["}


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


def _autoclose_json(candidate: str) -> str | None:
    if not candidate:
        return None
    stack: list[str] = []
    in_string = False
    escape = False
    for ch in candidate:
        if escape:
            escape = False
            continue
        if ch == "\\":
            if in_string:
                escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in _OPEN_TO_CLOSE:
            stack.append(ch)
        elif ch in _CLOSE_TO_OPEN:
            if stack and stack[-1] == _CLOSE_TO_OPEN[ch]:
                stack.pop()
            else:
                return None
    if in_string:
        return None
    if not stack:
        return candidate
    closing = "".join(_OPEN_TO_CLOSE[ch] for ch in reversed(stack))
    return candidate + closing


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
    autoclose = _autoclose_json(repaired)
    if autoclose and autoclose != repaired:
        repaired = autoclose
        unfenced_changed = True
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
                required = node.get("required")
                if isinstance(required, list):
                    node["required"] = [key for key in required if key in node["properties"]]
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


StructuredOutputFixer = Callable[[Any], bool]


def _type_includes(schema_node: dict[str, Any], expected: str) -> bool:
    schema_type = schema_node.get("type")
    if isinstance(schema_type, list):
        return expected in schema_type
    return schema_type == expected


def _collect_array_constraints(schema: Any, path: tuple[Any, ...]) -> list[tuple[tuple[Any, ...], int]]:
    constraints: list[tuple[tuple[Any, ...], int]] = []
    if not isinstance(schema, dict):
        return constraints
    is_array = _type_includes(schema, "array")
    max_items = schema.get("maxItems")
    if is_array and isinstance(max_items, int) and max_items >= 0:
        constraints.append((path, max_items))
    if is_array:
        items = schema.get("items")
        if isinstance(items, dict):
            constraints.extend(_collect_array_constraints(items, path + (_WILDCARD,)))
    if _type_includes(schema, "object") or schema.get("properties"):
        props = schema.get("properties", {})
        if isinstance(props, dict):
            for key, value in props.items():
                constraints.extend(_collect_array_constraints(value, path + (key,)))
    return constraints


def _apply_array_constraint(target: Any, path: tuple[Any, ...], max_items: int) -> bool:
    if not path:
        if isinstance(target, list) and len(target) > max_items:
            del target[max_items:]
            return True
        return False
    head, *rest = path
    if head is _WILDCARD:
        if not isinstance(target, list):
            return False
        changed = False
        for item in target:
            if rest:
                changed = _apply_array_constraint(item, tuple(rest), max_items) or changed
        return changed
    if not isinstance(target, dict):
        return False
    if not rest:
        arr = target.get(head)
        if not isinstance(arr, list) or len(arr) <= max_items:
            return False
        target[head] = arr[:max_items]
        return True
    if head not in target:
        return False
    return _apply_array_constraint(target[head], tuple(rest), max_items)


def build_schema_array_trimmer(schema: dict[str, Any] | None) -> StructuredOutputFixer:
    constraints = _collect_array_constraints(schema or {}, ())

    def _fixer(payload: Any) -> bool:
        if not constraints:
            return False
        changed = False
        for path, max_items in constraints:
            changed = _apply_array_constraint(payload, path, max_items) or changed
        return changed

    return _fixer


def parse_and_validate_structured_output(
    raw_text: str, schema: dict, auto_fixers: list[StructuredOutputFixer] | None = None
) -> tuple[str, Any]:
    canonical, parsed = postprocess_to_json_text(raw_text)
    changed = False
    if auto_fixers:
        for fixer in auto_fixers:
            try:
                if fixer(parsed):
                    changed = True
            except Exception:  # pragma: no cover - guard rail
                continue
    if changed:
        canonical = json.dumps(parsed, ensure_ascii=False, separators=(",", ":"))
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


def build_diagnostics_defaults_fixer(
    *, provider_defaults: dict[str, dict[str, str]], timing_defaults: dict[str, float | int] | None = None
) -> StructuredOutputFixer:
    def _ensure_provider(existing: Any) -> tuple[dict[str, dict[str, str]], bool]:
        provider = existing if isinstance(existing, dict) else {}
        changed = not isinstance(existing, dict)
        for key, defaults in provider_defaults.items():
            entry = provider.get(key)
            if not isinstance(entry, dict):
                provider[key] = dict(defaults)
                changed = True
            else:
                if "kind" not in entry and "kind" in defaults:
                    entry["kind"] = defaults["kind"]
                    changed = True
                if "model" not in entry and "model" in defaults:
                    entry["model"] = defaults["model"]
                    changed = True
        return provider, changed

    def _ensure_timing(existing: Any) -> tuple[dict[str, float | int], bool]:
        if not timing_defaults:
            if isinstance(existing, dict):
                return existing, False
            return {}, False
        timing = existing if isinstance(existing, dict) else {}
        changed = not isinstance(existing, dict)
        for key, default_value in timing_defaults.items():
            if key not in timing:
                timing[key] = default_value
                changed = True
        return timing, changed

    def _fixer(payload: Any) -> bool:
        if not isinstance(payload, dict):
            return False
        diagnostics = payload.get("diagnostics")
        if diagnostics is None:
            diagnostics = {}
            payload["diagnostics"] = diagnostics
        if not isinstance(diagnostics, dict):
            return False
        changed = False
        provider = diagnostics.get("provider")
        new_provider, provider_changed = _ensure_provider(provider)
        if provider_changed or provider is not new_provider:
            diagnostics["provider"] = new_provider
            changed = changed or provider_changed
        if timing_defaults:
            timing = diagnostics.get("timing_ms")
            new_timing, timing_changed = _ensure_timing(timing)
            if timing_changed or timing is not new_timing:
                diagnostics["timing_ms"] = new_timing
                changed = True
        return changed

    return _fixer
