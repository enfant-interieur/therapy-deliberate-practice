from __future__ import annotations

import pytest

from local_runtime.helpers.structured_output import (
    _autoclose_json,
    build_schema_array_trimmer,
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


def test_schema_array_trimmer_handles_nested_paths():
    schema = {
        "type": "object",
        "properties": {
            "overall": {
                "type": "object",
                "properties": {
                    "what_to_improve_next": {"type": "array", "maxItems": 2, "items": {"type": "string"}}
                },
            }
        },
    }
    fixer = build_schema_array_trimmer(schema)
    payload = {"overall": {"what_to_improve_next": ["a", "b", "c"]}}
    assert fixer(payload) is True
    assert payload["overall"]["what_to_improve_next"] == ["a", "b"]


def test_schema_array_trimmer_handles_wildcard_items():
    schema = {
        "type": "object",
        "properties": {
            "criterion_scores": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "evidence_quotes": {"type": "array", "maxItems": 1, "items": {"type": "string"}}
                    },
                },
            }
        },
    }
    fixer = build_schema_array_trimmer(schema)
    payload = {
        "criterion_scores": [
            {"evidence_quotes": ["one", "two"]},
            {"evidence_quotes": ["three", "four"]},
        ]
    }
    assert fixer(payload) is True
    assert payload["criterion_scores"][0]["evidence_quotes"] == ["one"]
    assert payload["criterion_scores"][1]["evidence_quotes"] == ["three"]


def test_schema_array_trimmer_handles_root_arrays():
    schema = {"type": "array", "maxItems": 1, "items": {"type": "number"}}
    fixer = build_schema_array_trimmer(schema)
    payload = [1, 2, 3]
    assert fixer(payload) is True
    assert payload == [1]


def test_autoclose_json_adds_missing_brackets():
    broken = '{"a": {"b": [1, 2}'
    repaired = _autoclose_json(broken)
    assert repaired == '{"a": {"b": [1, 2]}}'


def test_autoclose_json_ignores_strings():
    text = '{"quote": "["}'
    repaired = _autoclose_json(text)
    assert repaired == text
