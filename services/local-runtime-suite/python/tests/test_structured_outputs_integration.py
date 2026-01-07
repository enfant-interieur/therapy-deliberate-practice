from __future__ import annotations

from types import SimpleNamespace

import pytest


class StructuredStubModule:
    def __init__(self, outputs: list[dict]):
        self.outputs = outputs
        self.calls = 0

    async def run(self, req, ctx):
        self.calls += 1
        index = min(self.calls - 1, len(self.outputs) - 1)
        return self.outputs[index]


@pytest.fixture
def install_structured_stub(monkeypatch):
    def _install(outputs: list[dict]):
        module = StructuredStubModule(outputs)
        loaded = SimpleNamespace(spec=SimpleNamespace(id="local//test/structured"), module=module)
        monkeypatch.setattr("local_runtime.main._select_model", lambda endpoint, requested, _loaded=loaded: _loaded)
        return module

    return _install


def _structured_payload(stream: bool = False):
    return {
        "input": "ping",
        "stream": stream,
        "text": {
            "format": {
                "type": "json_schema",
                "schema": {
                    "type": "object",
                    "properties": {"a": {"type": "number"}},
                },
            }
        },
    }


def test_structured_retry_succeeds(client, install_structured_stub):
    stub = install_structured_stub(
        [
            {"output_text": '<thinking>draft</thinking>{"a":1,}'},
            {"output_text": '{"a":1}'},
        ]
    )
    response = client.post("/v1/responses", json=_structured_payload())
    assert response.status_code == 200
    body = response.json()
    assert body["output"][0]["content"][0]["text"] == '{"a":1}'
    assert stub.calls == 2


def test_structured_streaming_emits_only_valid_json(client, install_structured_stub):
    install_structured_stub(
        [
            {"output_text": '<think>info</think>```json\n{"a":1}\n```'},
        ]
    )
    with client.stream("POST", "/v1/responses", json=_structured_payload(stream=True)) as stream:
        chunks = list(stream.iter_text())
    body = "".join(chunks)
    assert body
    assert "<think>" not in body
    assert "```" not in body
    assert '{"a":1}' in body
