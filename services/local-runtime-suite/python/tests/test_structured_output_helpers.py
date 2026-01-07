from __future__ import annotations

import pytest

from local_runtime.helpers.structured_output import (
    make_openai_strict_schema,
    parse_and_validate_structured_output,
    validate_against_schema,
)


def test_postprocess_strips_thinking():
    canonical, parsed = parse_and_validate_structured_output('<thinking>plan</thinking>{"a":1}', {"type": "object", "properties": {"a": {"type": "number"}}})
    assert canonical == '{"a":1}'
    assert parsed == {"a": 1}


def test_postprocess_strips_code_fences():
    canonical, _ = parse_and_validate_structured_output("```json\n{\"a\":1}\n```", {"type": "object", "properties": {"a": {"type": "number"}}})
    assert canonical == '{"a":1}'


def test_postprocess_extracts_from_prose():
    canonical, _ = parse_and_validate_structured_output("ok {\"a\":1} thanks", {"type": "object", "properties": {"a": {"type": "number"}}})
    assert canonical == '{"a":1}'


def test_postprocess_repairs_trailing_commas():
    canonical, _ = parse_and_validate_structured_output('{"a":1,}', {"type": "object", "properties": {"a": {"type": "number"}}})
    assert canonical == '{"a":1}'


def test_postprocess_raises_for_non_json():
    schema = {"type": "object", "properties": {"a": {"type": "number"}}}
    with pytest.raises(ValueError):
        parse_and_validate_structured_output("hello world", schema)


def test_strict_schema_blocks_extra_keys():
    schema = make_openai_strict_schema({"type": "object", "properties": {"a": {"type": "number"}}})
    errors = validate_against_schema({"a": 1, "b": 2}, schema)
    assert errors


def test_strict_schema_requires_keys():
    schema = make_openai_strict_schema({"type": "object", "properties": {"a": {"type": "number"}}})
    errors = validate_against_schema({}, schema)
    assert errors
