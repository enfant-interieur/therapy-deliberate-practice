from __future__ import annotations

from typing import Any

from fastapi import UploadFile


def file_to_payload(upload: UploadFile) -> dict[str, Any]:
    return {
        "filename": upload.filename,
        "content_type": upload.content_type,
        "data": upload.file.read(),
    }
