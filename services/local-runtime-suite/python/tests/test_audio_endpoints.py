from __future__ import annotations


def test_audio_speech_disabled(client):
    response = client.post("/v1/audio/speech", json={"input": "Audio please", "response_format": "wav"})
    assert response.status_code == 503
    payload = response.json()
    assert payload["message"]
    assert "not enabled" in payload["message"].lower()


def test_audio_transcription_json(client):
    files = {"file": ("clip.wav", b"\x00" * 200, "audio/wav")}
    response = client.post("/v1/audio/transcriptions", data={"response_format": "json"}, files=files)
    assert response.status_code == 200
    payload = response.json()
    assert "text" in payload
    assert isinstance(payload["segments"], list)
