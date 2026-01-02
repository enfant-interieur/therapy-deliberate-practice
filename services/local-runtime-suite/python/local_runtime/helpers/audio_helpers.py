from __future__ import annotations

AUDIO_CONTENT_TYPES = {
    "mp3": "audio/mpeg",
    "opus": "audio/ogg; codecs=opus",
    "aac": "audio/aac",
    "flac": "audio/flac",
    "wav": "audio/wav",
    "pcm": "audio/pcm",
}


def resolve_content_type(fmt: str | None) -> str:
    if not fmt:
        return AUDIO_CONTENT_TYPES["mp3"]
    return AUDIO_CONTENT_TYPES.get(fmt, "audio/mpeg")
