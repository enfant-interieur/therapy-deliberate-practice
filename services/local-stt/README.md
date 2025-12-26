# Local STT Service

Python-based Whisper server that exposes:

- `GET /health`
- `POST /transcribe` with `{ audio: base64 }`

Use whisper.cpp or faster-whisper depending on your Apple Silicon setup.
