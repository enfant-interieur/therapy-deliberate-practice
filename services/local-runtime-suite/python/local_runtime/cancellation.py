from __future__ import annotations

import re
import threading
import time
from collections import OrderedDict
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field

CLIENT_REQUEST_ID_PATTERN = re.compile(r"^lrq_[0-9a-f]{32}$")
MODEL_LOCK_TIMEOUT_SECONDS = 0.1
FINISHED_REQUEST_CACHE_SIZE = 256


class InferenceCancelledError(RuntimeError):
    """Raised when an inference request has been cancelled."""


class InferenceTimeoutError(InferenceCancelledError):
    """Raised when the gateway-owned inference deadline expires."""


class ModelBusyError(RuntimeError):
    """Raised instead of queueing behind another inference request."""


class RequestIdInUseError(RuntimeError):
    """Raised when a client reuses an identifier that is still active."""


@dataclass
class CancellationToken:
    request_id: str
    deadline: float | None = None
    _event: threading.Event = field(default_factory=threading.Event, repr=False)
    _reason: str = field(default="cancelled", repr=False)

    def cancel(self, reason: str = "cancelled") -> None:
        self._reason = reason
        self._event.set()

    @property
    def cancelled(self) -> bool:
        if self._event.is_set():
            return True
        if self.deadline is not None and time.monotonic() >= self.deadline:
            self.cancel("timeout")
            return True
        return False

    def raise_if_cancelled(self) -> None:
        if self.cancelled:
            if self._reason == "timeout":
                raise InferenceTimeoutError("The local inference request exceeded its deadline.")
            raise InferenceCancelledError("The local inference request was cancelled.")


class ActiveRequestRegistry:
    """Own cancellation tokens without retaining request content or credentials."""

    def __init__(self, *, finished_cache_size: int = FINISHED_REQUEST_CACHE_SIZE) -> None:
        self._active: dict[str, CancellationToken] = {}
        self._finished: OrderedDict[str, None] = OrderedDict()
        self._finished_cache_size = finished_cache_size
        self._lock = threading.Lock()

    def register(self, request_id: str, *, timeout_seconds: float) -> CancellationToken:
        with self._lock:
            if request_id in self._active:
                raise RequestIdInUseError(f"Request identifier {request_id} is already active.")
            self._finished.pop(request_id, None)
            token = CancellationToken(
                request_id=request_id,
                deadline=time.monotonic() + timeout_seconds,
            )
            self._active[request_id] = token
            return token

    def cancel(self, request_id: str) -> None:
        with self._lock:
            token = self._active.get(request_id)
        if token is not None:
            token.cancel()

    def finish(self, request_id: str) -> None:
        with self._lock:
            self._active.pop(request_id, None)
            self._finished[request_id] = None
            self._finished.move_to_end(request_id)
            while len(self._finished) > self._finished_cache_size:
                self._finished.popitem(last=False)

    def is_active(self, request_id: str) -> bool:
        with self._lock:
            return request_id in self._active


def validate_client_request_id(value: str) -> str:
    if not CLIENT_REQUEST_ID_PATTERN.fullmatch(value):
        raise ValueError("X-Request-ID must use the form lrq_ followed by 32 lowercase hex characters.")
    return value


@contextmanager
def acquire_model_lock(
    lock: threading.Lock,
    token: CancellationToken | None,
    *,
    timeout_seconds: float = MODEL_LOCK_TIMEOUT_SECONDS,
) -> Iterator[None]:
    if token is not None:
        token.raise_if_cancelled()
    acquired = lock.acquire(timeout=timeout_seconds)
    if not acquired:
        raise ModelBusyError("The previous local model request is still finishing. Retry in a moment.")
    try:
        if token is not None:
            token.raise_if_cancelled()
        yield
    finally:
        lock.release()
