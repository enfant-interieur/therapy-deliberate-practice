from __future__ import annotations

AUDIO_MEDIA_TYPES = {
    "mp3": "audio/mpeg",
    "opus": "audio/opus",
    "aac": "audio/aac",
    "flac": "audio/flac",
    "wav": "audio/wav",
    "pcm": "audio/pcm",
}

def generate_wav_bytes(text: str, sample_rate: int = 22050) -> bytes:
    import io
    import math
    import wave

    duration = max(0.2, min(len(text) * 0.02, 1.5))
    frames = int(sample_rate * duration)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        for i in range(frames):
            sample = int(32767 * 0.2 * math.sin(2 * math.pi * 440 * i / sample_rate))
            wav_file.writeframesraw(sample.to_bytes(2, byteorder="little", signed=True))
    return buffer.getvalue()


def media_type_for(format_name: str) -> str:
    return AUDIO_MEDIA_TYPES.get(format_name, "audio/mpeg")
