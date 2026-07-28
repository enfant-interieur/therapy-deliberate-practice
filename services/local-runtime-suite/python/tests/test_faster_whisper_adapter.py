from __future__ import annotations

import logging
import sys
import threading
from types import SimpleNamespace

import pytest

from local_runtime.models import model_stt_faster_whisper
from local_runtime.runtime_types import RunContext, RunRequest


class FakeWhisperModel:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def transcribe(self, audio_path: str, **kwargs):
        with open(audio_path, "rb") as handle:
            audio_bytes = handle.read()
        self.calls.append({"audio_bytes": audio_bytes, **kwargs})
        segments = [
            SimpleNamespace(
                start=0.0,
                end=0.8,
                text=" I hear you.",
                words=[
                    SimpleNamespace(
                        word=" I",
                        start=0.0,
                        end=0.2,
                        probability=0.98,
                    )
                ],
            ),
            SimpleNamespace(start=0.8, end=1.4, text=" What feels hardest?", words=[]),
        ]
        info = SimpleNamespace(language="en", language_probability=0.99)
        return iter(segments), info


class FakeRegistry:
    def __init__(self, instance: dict) -> None:
        self.instance = instance

    async def ensure_instance(self, model_id: str, ctx: RunContext):
        assert model_id == model_stt_faster_whisper.SPEC["id"]
        return self.instance


def build_context(tmp_path, model: FakeWhisperModel) -> RunContext:
    instance = {"model": model, "lock": threading.Lock()}
    return RunContext(
        request_id="request-1",
        logger=logging.getLogger("faster-whisper-adapter-test"),
        data_dir=str(tmp_path / "data"),
        cache_dir=str(tmp_path / "cache"),
        platform="linux-x64",
        registry=FakeRegistry(instance),  # type: ignore[arg-type]
        http_client=None,
    )


def test_faster_whisper_load_applies_the_pinned_revision(monkeypatch, tmp_path) -> None:
    calls = []

    class WhisperModel:
        def __init__(self, model_ref, **kwargs):
            calls.append((model_ref, kwargs))

    monkeypatch.setitem(
        sys.modules,
        "faster_whisper",
        SimpleNamespace(WhisperModel=WhisperModel),
    )
    context = SimpleNamespace(
        logger=SimpleNamespace(info=lambda *_args, **_kwargs: None),
        cache_dir=str(tmp_path),
    )

    instance = model_stt_faster_whisper.load(context)

    assert instance["revision"] == model_stt_faster_whisper.SPEC["backend"]["revision"]
    assert calls == [
        (
            model_stt_faster_whisper.SPEC["backend"]["model_ref"],
            {
                "device": "auto",
                "compute_type": "default",
                "revision": model_stt_faster_whisper.SPEC["backend"]["revision"],
                "download_root": str(tmp_path),
            },
        )
    ]


@pytest.mark.asyncio
async def test_faster_whisper_runs_real_adapter_and_cleans_temp_audio(tmp_path) -> None:
    model = FakeWhisperModel()
    context = build_context(tmp_path, model)
    request = RunRequest(
        endpoint="audio.transcriptions",
        model=model_stt_faster_whisper.SPEC["id"],
        form={"language": "en", "prompt": "therapy context"},
        files={
            "file": {
                "filename": "response.webm",
                "content_type": "audio/webm",
                "data": b"real-audio-bytes",
            }
        },
    )

    result = await model_stt_faster_whisper.run(request, context)

    assert result["text"] == "I hear you. What feels hardest?"
    assert result["language"] == "en"
    assert result["language_probability"] == 0.99
    assert result["segments"][0]["words"][0]["probability"] == 0.98
    assert model.calls[0]["audio_bytes"] == b"real-audio-bytes"
    assert model.calls[0]["vad_filter"] is True
    assert list((tmp_path / "cache").iterdir()) == []


@pytest.mark.asyncio
async def test_faster_whisper_stream_emits_transcript_events(tmp_path) -> None:
    model = FakeWhisperModel()
    context = build_context(tmp_path, model)
    request = RunRequest(
        endpoint="audio.transcriptions",
        model=model_stt_faster_whisper.SPEC["id"],
        files={
            "file": {
                "filename": "response.wav",
                "content_type": "audio/wav",
                "data": b"wave-data",
            }
        },
        stream=True,
    )

    stream = await model_stt_faster_whisper.run(request, context)
    events = [event async for event in stream]

    assert [event["event"] for event in events] == [
        "transcript.text.delta",
        "transcript.text.delta",
        "transcript.text.done",
    ]
    assert events[-1]["data"]["text"] == "I hear you. What feels hardest?"
