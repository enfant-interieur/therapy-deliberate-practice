from __future__ import annotations


def _collect_events(stream_response) -> list[str]:
    events: list[str] = []
    for line in stream_response.iter_lines():
        if isinstance(line, bytes):
            line = line.decode("utf-8")
        if line.startswith("event:"):
            events.append(line.split("event:", 1)[1].strip())
    return events


def test_responses_streaming_events(client):
    with client.stream("POST", "/v1/responses", json={"input": "Stream me", "stream": True}) as response:
        assert response.status_code == 200
        events = _collect_events(response)
    assert "response.output_text.delta" in events
    assert "response.completed" in events


def test_transcription_streaming_events(client):
    files = {"file": ("test.wav", b"\x00" * 100, "audio/wav")}
    data = {"stream": "true", "response_format": "json"}
    with client.stream("POST", "/v1/audio/transcriptions", data=data, files=files) as response:
        assert response.status_code == 200
        events = _collect_events(response)
    assert "transcript.text.delta" in events
    assert "transcript.text.done" in events
