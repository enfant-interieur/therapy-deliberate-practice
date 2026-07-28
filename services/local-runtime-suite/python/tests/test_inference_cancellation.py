from __future__ import annotations

import asyncio
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from types import SimpleNamespace

import pytest

from local_runtime.cancellation import (
    ActiveRequestRegistry,
    CancellationToken,
    InferenceCancelledError,
    InferenceTimeoutError,
    ModelBusyError,
    RequestIdInUseError,
    acquire_model_lock,
    validate_client_request_id,
)
from local_runtime.main import _finalize_inference_stream, _select_model, app
from local_runtime.models import (
    model_llm_qwen3_hf,
    model_llm_qwen3_mlx,
    model_stt_faster_whisper,
    model_stt_parakeet_mlx,
)

CLIENT_REQUEST_ID = "lrq_" + "a" * 32


def test_request_registry_rejects_collisions_and_cancellation_is_idempotent() -> None:
    registry = ActiveRequestRegistry(finished_cache_size=2)
    token = registry.register(CLIENT_REQUEST_ID, timeout_seconds=300)

    with pytest.raises(RequestIdInUseError):
        registry.register(CLIENT_REQUEST_ID, timeout_seconds=300)

    registry.cancel(CLIENT_REQUEST_ID)
    registry.cancel(CLIENT_REQUEST_ID)
    assert token.cancelled
    registry.finish(CLIENT_REQUEST_ID)
    assert not registry.is_active(CLIENT_REQUEST_ID)
    registry.cancel(CLIENT_REQUEST_ID)


@pytest.mark.parametrize(
    "request_id",
    [
        "req_" + "a" * 32,
        "lrq_" + "A" * 32,
        "lrq_" + "a" * 31,
        "lrq_" + "g" * 32,
        "../lrq_" + "a" * 32,
    ],
)
def test_client_request_id_validation_fails_closed(request_id: str) -> None:
    with pytest.raises(ValueError):
        validate_client_request_id(request_id)
    assert validate_client_request_id(CLIENT_REQUEST_ID) == CLIENT_REQUEST_ID


def test_model_lock_fails_fast_instead_of_queueing() -> None:
    lock = threading.Lock()
    assert lock.acquire()
    started = time.monotonic()
    try:
        with (
            pytest.raises(ModelBusyError),
            acquire_model_lock(
                lock,
                CancellationToken(CLIENT_REQUEST_ID),
            ),
        ):
            pytest.fail("busy lock must not be acquired")
    finally:
        lock.release()
    assert time.monotonic() - started < 0.5


@pytest.mark.asyncio
async def test_qwen_mlx_cancellation_stops_iteration_and_releases_lock(monkeypatch) -> None:
    token = CancellationToken(CLIENT_REQUEST_ID)
    lock = threading.Lock()

    def stream_generate(*_args, **_kwargs):
        yield SimpleNamespace(text="first")
        token.cancel()
        yield SimpleNamespace(text="second")

    monkeypatch.setitem(sys.modules, "mlx_lm", SimpleNamespace(stream_generate=stream_generate))
    monkeypatch.setattr(
        model_llm_qwen3_mlx,
        "_build_sampling_components",
        lambda _params: ("sampler", ["processor"]),
    )

    with pytest.raises(InferenceCancelledError):
        await model_llm_qwen3_mlx._generate_text(
            {"model": object(), "tokenizer": object(), "lock": lock},
            "prompt",
            model_llm_qwen3_mlx._generation_params({}),
            token,
        )
    assert lock.acquire(blocking=False)
    lock.release()


@pytest.mark.asyncio
async def test_qwen_mlx_streaming_reports_busy_before_returning_an_iterator(monkeypatch) -> None:
    lock = threading.Lock()
    assert lock.acquire()
    monkeypatch.setitem(
        sys.modules,
        "mlx_lm",
        SimpleNamespace(stream_generate=lambda *_args, **_kwargs: iter(())),
    )
    monkeypatch.setattr(
        model_llm_qwen3_mlx,
        "_build_sampling_components",
        lambda _params: ("sampler", ["processor"]),
    )

    started = time.monotonic()
    try:
        with pytest.raises(ModelBusyError):
            await model_llm_qwen3_mlx._generate_stream(
                {"model": object(), "tokenizer": object(), "lock": lock},
                "prompt",
                model_llm_qwen3_mlx._generation_params({}),
                CancellationToken(CLIENT_REQUEST_ID),
            )
    finally:
        lock.release()
    assert time.monotonic() - started < 0.5


def test_qwen_hf_stopping_criterion_observes_cancellation(monkeypatch) -> None:
    class StoppingCriteria:
        pass

    class StoppingCriteriaList(list):
        pass

    monkeypatch.setitem(
        sys.modules,
        "transformers",
        SimpleNamespace(
            StoppingCriteria=StoppingCriteria,
            StoppingCriteriaList=StoppingCriteriaList,
        ),
    )
    token = CancellationToken(CLIENT_REQUEST_ID)
    criteria = model_llm_qwen3_hf._cancellation_stopping_criteria(token)

    assert criteria[0](None, None) is False
    token.cancel()
    assert criteria[0](None, None) is True


@pytest.mark.asyncio
async def test_qwen_hf_generation_cancels_and_releases_lock_within_bound(monkeypatch) -> None:
    class StoppingCriteria:
        pass

    class StoppingCriteriaList(list):
        pass

    class Inputs(dict):
        @property
        def input_ids(self):
            return self["input_ids"]

        def to(self, _device):
            return self

    entered = threading.Event()
    lock = threading.Lock()
    token = CancellationToken(CLIENT_REQUEST_ID)

    class Tokenizer:
        def __call__(self, *_args, **_kwargs):
            return Inputs(input_ids=SimpleNamespace(shape=(1, 1)))

        def decode(self, *_args, **_kwargs):
            return "unused"

    class Model:
        def generate(self, **kwargs):
            entered.set()
            criterion = kwargs["stopping_criteria"][0]
            while not criterion(None, None):
                time.sleep(0.005)
            return [[0]]

    monkeypatch.setitem(
        sys.modules,
        "transformers",
        SimpleNamespace(
            StoppingCriteria=StoppingCriteria,
            StoppingCriteriaList=StoppingCriteriaList,
        ),
    )
    monkeypatch.setattr(
        model_llm_qwen3_hf,
        "_load_backend",
        lambda: (SimpleNamespace(inference_mode=nullcontext), None, None, None),
    )

    task = asyncio.create_task(
        model_llm_qwen3_hf._generate(
            {
                "tokenizer": Tokenizer(),
                "model": Model(),
                "device": "cpu",
                "lock": lock,
            },
            "prompt",
            model_llm_qwen3_hf._generation_params({}),
            token,
        )
    )
    assert await asyncio.to_thread(entered.wait, 0.5)
    started = time.monotonic()
    token.cancel()
    with pytest.raises(InferenceCancelledError):
        await asyncio.wait_for(task, timeout=1)
    assert time.monotonic() - started < 1
    assert lock.acquire(blocking=False)
    lock.release()


def test_faster_whisper_checks_cancellation_between_segments() -> None:
    token = CancellationToken(CLIENT_REQUEST_ID)
    lock = threading.Lock()

    class Model:
        def transcribe(self, *_args, **_kwargs):
            def segments():
                yield SimpleNamespace(start=0, end=1, text="first", words=None)
                token.cancel()
                yield SimpleNamespace(start=1, end=2, text="second", words=None)

            return segments(), SimpleNamespace(language="en", language_probability=1.0)

    with pytest.raises(InferenceCancelledError):
        model_stt_faster_whisper._transcribe_sync(
            {"model": Model(), "lock": lock},
            "/tmp/audio.wav",
            language=None,
            prompt=None,
            token=token,
        )
    assert lock.acquire(blocking=False)
    lock.release()


@pytest.mark.asyncio
async def test_parakeet_retry_fails_fast_while_non_interruptible_call_finishes() -> None:
    entered = threading.Event()
    release = threading.Event()
    lock = threading.Lock()

    class Model:
        def transcribe(self, *_args, **_kwargs):
            entered.set()
            assert release.wait(timeout=2)
            return "finished"

    instance = {"model": Model(), "lock": lock}
    first = model_stt_parakeet_mlx._run_transcribe(
        instance,
        "/tmp/audio.wav",
        chunk_duration=120,
        overlap_duration=15,
        decoding_config=None,
        token=CancellationToken(CLIENT_REQUEST_ID),
    )
    first_task = asyncio.create_task(first)
    assert await asyncio.to_thread(entered.wait, 1)

    started = time.monotonic()
    with pytest.raises(ModelBusyError):
        await model_stt_parakeet_mlx._run_transcribe(
            instance,
            "/tmp/audio.wav",
            chunk_duration=120,
            overlap_duration=15,
            decoding_config=None,
            token=CancellationToken("lrq_" + "b" * 32),
        )
    assert time.monotonic() - started < 0.5

    release.set()
    assert await first_task == "finished"


def test_authenticated_cancellation_route_is_idempotent(client) -> None:
    response = client.post(
        "/v1/requests/cancel",
        json={"request_id": CLIENT_REQUEST_ID},
    )
    assert response.status_code == 202
    assert response.json() == {
        "status": "cancellation_requested",
        "request_id": CLIENT_REQUEST_ID,
    }

    repeat = client.post(
        "/v1/requests/cancel",
        json={"request_id": CLIENT_REQUEST_ID},
    )
    assert repeat.status_code == 202


def test_cancellation_route_rejects_non_object_json(client) -> None:
    response = client.post(
        "/v1/requests/cancel",
        json=[],
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request_id"


def test_authenticated_cancellation_route_signals_an_active_request(client) -> None:
    token = app.state.active_requests.register(CLIENT_REQUEST_ID, timeout_seconds=300)
    try:
        response = client.post(
            "/v1/requests/cancel",
            json={"request_id": CLIENT_REQUEST_ID},
        )
        assert response.status_code == 202
        assert token.cancelled
    finally:
        app.state.active_requests.finish(CLIENT_REQUEST_ID)


def test_live_gateway_cancellation_returns_499_and_cleans_registry(client, monkeypatch) -> None:
    entered = threading.Event()

    async def cancellable_fixture(_request, context):
        entered.set()
        while True:
            context.cancellation_token.raise_if_cancelled()
            await asyncio.sleep(0.01)

    selected = _select_model("responses", None)
    monkeypatch.setattr(selected.module, "run", cancellable_fixture)

    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(
            client.post,
            "/v1/responses",
            headers={"X-Request-ID": CLIENT_REQUEST_ID},
            json={"input": "fixture"},
        )
        assert entered.wait(timeout=1)
        cancelled = client.post(
            "/v1/requests/cancel",
            json={"request_id": CLIENT_REQUEST_ID},
        )
        response = pending.result(timeout=1)

    assert cancelled.status_code == 202
    assert response.status_code == 499
    assert response.json()["error"]["code"] == "inference_cancelled"
    assert not app.state.active_requests.is_active(CLIENT_REQUEST_ID)


@pytest.mark.asyncio
async def test_started_stream_emits_typed_cancellation_event_and_cleans_registry(client) -> None:
    token = app.state.active_requests.register(CLIENT_REQUEST_ID, timeout_seconds=300)
    watcher = asyncio.create_task(asyncio.sleep(60))

    async def cancelled_stream():
        yield {"event": "response.created", "data": {"id": "fixture"}}
        raise InferenceCancelledError("The local inference request was cancelled.")

    events = [
        event
        async for event in _finalize_inference_stream(
            cancelled_stream(),
            CLIENT_REQUEST_ID,
            token,
            watcher,
        )
    ]

    assert events[-1] == {
        "event": "error",
        "data": {
            "error": {
                "type": "inference_cancelled",
                "code": "inference_cancelled",
                "message": "The local inference request was cancelled.",
                "status": 499,
            },
            "request_id": CLIENT_REQUEST_ID,
        },
    }
    assert not app.state.active_requests.is_active(CLIENT_REQUEST_ID)


def test_gateway_rejects_invalid_client_request_id_before_inference(client) -> None:
    response = client.get(
        "/health",
        headers={"X-Request-ID": "request-from-untrusted-client"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request_id"


def test_inference_request_registry_is_cleaned_after_success(client, monkeypatch) -> None:
    async def run_fixture(_request, context):
        assert context.cancellation_token is not None
        assert app.state.active_requests.is_active(context.request_id)
        return "fixture response"

    selected = _select_model("responses", None)
    monkeypatch.setattr(selected.module, "run", run_fixture)

    response = client.post(
        "/v1/responses",
        headers={"X-Request-ID": CLIENT_REQUEST_ID},
        json={"input": "fixture"},
    )

    assert response.status_code == 200
    assert not app.state.active_requests.is_active(CLIENT_REQUEST_ID)


def test_model_busy_is_returned_as_typed_409(client, monkeypatch) -> None:
    async def busy_fixture(_request, _context):
        raise ModelBusyError("The previous local model request is still finishing. Retry in a moment.")

    selected = _select_model("responses", None)
    monkeypatch.setattr(selected.module, "run", busy_fixture)

    response = client.post(
        "/v1/responses",
        headers={"X-Request-ID": CLIENT_REQUEST_ID},
        json={"input": "fixture"},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "model_busy"
    assert not app.state.active_requests.is_active(CLIENT_REQUEST_ID)


def test_inference_deadline_is_returned_as_typed_504(client, monkeypatch) -> None:
    async def timeout_fixture(_request, _context):
        raise InferenceTimeoutError("The local inference request exceeded its deadline.")

    selected = _select_model("responses", None)
    monkeypatch.setattr(selected.module, "run", timeout_fixture)

    response = client.post(
        "/v1/responses",
        headers={"X-Request-ID": CLIENT_REQUEST_ID},
        json={"input": "fixture"},
    )

    assert response.status_code == 504
    assert response.json()["error"]["code"] == "inference_timeout"
    assert not app.state.active_requests.is_active(CLIENT_REQUEST_ID)
