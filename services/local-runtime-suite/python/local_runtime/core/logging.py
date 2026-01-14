from __future__ import annotations

import contextvars
import json
import logging
import os
import queue
import time
from collections import deque
from logging.handlers import QueueHandler, QueueListener, RotatingFileHandler
from pathlib import Path
from typing import Any

_LOG_CONTEXT: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar(
    "local_runtime_log_ctx", default={}
)
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
_LOG_QUEUE: queue.SimpleQueue[logging.LogRecord] = queue.SimpleQueue()
_LOG_LISTENER: QueueListener | None = None
_LOG_DIR: Path | None = None
DEFAULT_LOG_DIR = Path.home() / ".therapy" / "local-runtime" / "logs"


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


def _resolve_log_dir(explicit: str | Path | None = None) -> Path:
    if explicit:
        return Path(explicit).expanduser()
    raw = os.getenv("LOCAL_RUNTIME_LOG_DIR")
    if raw:
        return Path(raw).expanduser()
    return DEFAULT_LOG_DIR


def configure_logging(level: int = logging.INFO, log_dir: str | Path | None = None) -> logging.Logger:
    global _LOG_LISTENER, _LOG_DIR
    formatter = StructuredFormatter()
    context_filter = ContextFilter()
    target_dir = _resolve_log_dir(log_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    _LOG_DIR = target_dir
    log_path = target_dir / "gateway.log"
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.addFilter(context_filter)
    file_handler = RotatingFileHandler(
        log_path, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    file_handler.setFormatter(formatter)
    file_handler.addFilter(context_filter)
    buffer_handler = InMemoryLogHandler()
    buffer_handler.setFormatter(formatter)
    buffer_handler.addFilter(context_filter)
    queue_handler = QueueHandler(_LOG_QUEUE)
    root = logging.getLogger()
    root.handlers = [queue_handler]
    root.setLevel(level)
    if _LOG_LISTENER:
        _LOG_LISTENER.stop()
    listener = QueueListener(
        _LOG_QUEUE, console_handler, file_handler, buffer_handler, respect_handler_level=True
    )
    listener.start()
    _LOG_LISTENER = listener
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


def shutdown_logging() -> None:
    global _LOG_LISTENER
    if _LOG_LISTENER:
        _LOG_LISTENER.stop()
        _LOG_LISTENER = None


def get_log_dir() -> Path:
    if _LOG_DIR:
        return _LOG_DIR
    return DEFAULT_LOG_DIR


def write_diagnostic_report(kind: str, payload: dict[str, Any]) -> Path:
    log_dir = get_log_dir()
    reports_dir = log_dir / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    timestamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
    path = reports_dir / f"{kind}-{timestamp}.json"
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return path
