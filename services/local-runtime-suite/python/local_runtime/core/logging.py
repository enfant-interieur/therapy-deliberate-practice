from __future__ import annotations

import json
import logging
import time
from collections import deque
from typing import Any

import contextvars

_LOG_CONTEXT: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar("local_runtime_log_ctx", default={})
_LOG_BUFFER: deque[dict[str, Any]] = deque(maxlen=500)
_RESERVED_LOG_RECORD_ATTRS = {
    "name",
    "msg",
    "args",
    "levelname",
    "levelno",
    "pathname",
    "filename",
    "module",
    "exc_info",
    "exc_text",
    "stack_info",
    "lineno",
    "funcName",
    "created",
    "msecs",
    "relativeCreated",
    "thread",
    "threadName",
    "processName",
    "process",
    "message",
}


class ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        context = _LOG_CONTEXT.get({})
        for key, value in context.items():
            setattr(record, key, value)
        return True


class StructuredFormatter(logging.Formatter):
    def _normalize(self, value: Any) -> Any:
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, dict):
            return {str(k): self._normalize(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [self._normalize(v) for v in value]
        return str(value)

    def format(self, record: logging.LogRecord) -> str:
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
        payload: dict[str, Any] = {
            "timestamp": f"{timestamp}.{int(record.msecs):03d}Z",
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if (
                key in _RESERVED_LOG_RECORD_ATTRS
                or key == "exc_info"
                or key == "exc_text"
                or key in payload
                or value is None
            ):
                continue
            payload[key] = self._normalize(value)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


class InMemoryLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            formatted = self.format(record)
            payload = json.loads(formatted)
        except Exception:
            payload = {
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                "level": "error",
                "logger": "local-runtime",
                "message": "log_buffer_format_error",
            }
        _LOG_BUFFER.append(payload)


def configure_logging(level: int = logging.INFO) -> logging.Logger:
    formatter = StructuredFormatter()
    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    handler.addFilter(ContextFilter())
    buffer_handler = InMemoryLogHandler()
    buffer_handler.setFormatter(formatter)
    buffer_handler.addFilter(ContextFilter())
    root = logging.getLogger()
    root.setLevel(level)
    root.handlers = [handler, buffer_handler]
    logger = logging.getLogger("local-runtime")
    return logger


def push_log_context(**kwargs: Any) -> contextvars.Token:
    context = dict(_LOG_CONTEXT.get({}))
    for key, value in kwargs.items():
        if value is not None:
            context[key] = value
    return _LOG_CONTEXT.set(context)


def pop_log_context(token: contextvars.Token) -> None:
    _LOG_CONTEXT.reset(token)


def get_recent_logs(limit: int = 200) -> list[dict[str, Any]]:
    if limit <= 0:
        return []
    if limit >= len(_LOG_BUFFER):
        return list(_LOG_BUFFER)
    return list(_LOG_BUFFER)[-limit:]
