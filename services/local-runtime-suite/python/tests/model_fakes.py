from __future__ import annotations

from local_runtime.helpers.responses_helpers import stream_events


async def _response_events(model_id: str):
    for event, data in stream_events(model_id, "fixture response"):
        yield {"event": event, "data": data}


async def _transcription_events():
    yield {"event": "transcript.text.delta", "data": {"text": "fixture"}}
    yield {"event": "transcript.text.done", "data": {"text": "fixture transcript"}}


async def fake_model_run(req, _ctx):
    if req.endpoint == "responses":
        if req.stream:
            return _response_events(req.model or "local//test/responses")
        return "fixture response"
    if req.endpoint in {"audio.transcriptions", "audio.translations"}:
        if req.stream:
            return _transcription_events()
        return {
            "text": "fixture transcript",
            "segments": [
                {
                    "id": 0,
                    "start": 0.0,
                    "end": 0.1,
                    "text": "fixture transcript",
                }
            ],
        }
    if req.endpoint == "audio.speech":
        return b"RIFFfixture"
    raise AssertionError(f"Unexpected fixture endpoint: {req.endpoint}")
