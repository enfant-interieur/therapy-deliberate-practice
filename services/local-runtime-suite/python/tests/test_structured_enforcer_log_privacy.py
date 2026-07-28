from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from local_runtime.core.logging import configure_logging, get_recent_logs
from local_runtime.helpers.structured_enforcer import (
    StructuredFormatConfig,
    StructuredOutputEnforcer,
    StructuredOutputFailure,
)
from local_runtime.runtime_types import RunContext

SECRET_MODEL_VALUE = "THERAPY_CONTENT_MUST_NOT_ENTER_LOGS_7a07f1"
REQUEST_ID = "privacy-log-fixture"


class InvalidStructuredModule:
    @staticmethod
    async def run(_request, _context):
        return {
            "output_text": json.dumps(
                {"score": SECRET_MODEL_VALUE},
                ensure_ascii=False,
            )
        }


@pytest.mark.asyncio
async def test_schema_failure_logs_only_a_bounded_category(capsys) -> None:
    logger = configure_logging()
    context = RunContext(
        request_id=REQUEST_ID,
        logger=logger,
        data_dir="/tmp/data",
        cache_dir="/tmp/cache",
        platform="test",
        registry=None,  # type: ignore[arg-type]
        http_client=None,
    )
    selected = SimpleNamespace(
        spec=SimpleNamespace(id="local//fixture/privacy"),
        module=InvalidStructuredModule,
    )
    schema = {
        "type": "object",
        "properties": {"score": {"type": "integer"}},
        "required": ["score"],
        "additionalProperties": False,
    }
    enforcer = StructuredOutputEnforcer(
        selected=selected,
        ctx=context,
        config=StructuredFormatConfig(
            schema_name="PrivacyFixture",
            schema=schema,
            effective_schema=schema,
            strict=True,
        ),
        request_id=REQUEST_ID,
    )
    enforcer.max_attempts = 2

    with pytest.raises(StructuredOutputFailure):
        await enforcer.run({})

    relevant_logs = [record for record in get_recent_logs() if record.get("request_id") == REQUEST_ID]
    serialized_logs = json.dumps(relevant_logs, ensure_ascii=False)
    ordinary_logs = capsys.readouterr().err

    assert relevant_logs
    assert any(
        record.get("message") == "structured_output.retry"
        and record.get("reason") == "schema_validation_failed"
        for record in relevant_logs
    )
    assert SECRET_MODEL_VALUE not in serialized_logs
    assert SECRET_MODEL_VALUE not in ordinary_logs
