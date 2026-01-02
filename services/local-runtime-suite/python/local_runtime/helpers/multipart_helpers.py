from __future__ import annotations

from typing import Any


class UploadedFile:
    def __init__(self, filename: str, content_type: str, data: bytes) -> None:
        self.filename = filename
        self.content_type = content_type
        self.data = data


def enforce_max_size(file_obj: UploadedFile, max_mb: int) -> None:
    if len(file_obj.data) > max_mb * 1024 * 1024:
        raise ValueError(f"File exceeds {max_mb}MB limit")


def extract_form_fields(form: Any) -> tuple[dict, dict]:
    files: dict[str, UploadedFile] = {}
    fields: dict[str, Any] = {}
    for key, value in form.items():
        if hasattr(value, "filename"):
            data = value.file.read()
            files[key] = UploadedFile(value.filename, value.content_type or "application/octet-stream", data)
        else:
            fields[key] = value
    return fields, files
