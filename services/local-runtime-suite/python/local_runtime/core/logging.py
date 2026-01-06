from __future__ import annotations

import json
import logging
import time
from typing import Any

import contextvars

_LOG_CONTEXT: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar("local_runtime_log_ctx", default={})


class ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        context = _LOG_CONTEXT.get({})
        for key, value in context.items():
            setattr(record, key, value)
        return True


class StructuredFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
        payload: dict[str, Any] = {
            "timestamp": f"{timestamp}.{int(record.msecs):03d}Z",
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in ("request_id", "endpoint", "model_id", "platform_id", "phase", "status", "duration_ms"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: int = logging.INFO) -> logging.Logger:
    handler = logging.StreamHandler()
    handler.setFormatter(StructuredFormatter())
    handler.addFilter(ContextFilter())
    root = logging.getLogger()
    root.setLevel(level)
    root.handlers = [handler]
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
