from __future__ import annotations

import array
import io
import wave

import pytest

from local_runtime.helpers.multipart_helpers import UploadedFile
from local_runtime.models import model_stt_parakeet_mlx as parakeet_module


class DummyLogger:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict | None]] = []

    def info(self, event: str, extra: dict | None = None) -> None:
        self.events.append((event, extra))


class DummyContext:
    def __init__(self) -> None:
        self.logger = DummyLogger()


def build_wav(amplitude: int, sample_count: int = 4000) -> bytes:
    samples = array.array("h", [amplitude] * sample_count)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(16000)
        writer.writeframes(samples.tobytes())
    return buffer.getvalue()


@pytest.fixture(autouse=True)
def reset_boost_thresholds(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(parakeet_module, "BOOST_MIN_RMS", 1000)
    monkeypatch.setattr(parakeet_module, "BOOST_TARGET_RMS", 4000)
    monkeypatch.setattr(parakeet_module, "BOOST_MAX_GAIN", 6.0)


def test_boost_skipped_when_audio_is_loud():
    upload = UploadedFile("clip.wav", "audio/wav", build_wav(amplitude=4000))
    ctx = DummyContext()
    boosted, meta = parakeet_module._maybe_boost_wav(upload, ctx)
    assert boosted is upload
    assert meta is None
    assert ctx.logger.events == []


def test_boost_applied_for_quiet_wav():
    upload = UploadedFile("clip.wav", "audio/wav", build_wav(amplitude=50))
    ctx = DummyContext()
    boosted, meta = parakeet_module._maybe_boost_wav(upload, ctx)
    assert boosted is not upload
    assert meta is not None
    assert meta["gain"] > 1.0
    assert len(boosted.data) == len(upload.data)
    # Ensure logging captured the normalization event.
    assert any(event == "parakeet_mlx.audio.boost" for event, _ in ctx.logger.events)
