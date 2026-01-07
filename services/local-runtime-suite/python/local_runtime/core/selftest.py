from __future__ import annotations

import io
import time
import wave
from typing import Any, Callable

from local_runtime.api.openai_compat import format_responses_create
from local_runtime.core.loader import LoadedModel
from local_runtime.core.readiness import ReadinessTracker
from local_runtime.core.registry import ModelRegistry
from local_runtime.runtime_types import RunContext, RunRequest

ContextFactory = Callable[[str, str | None, str | None], RunContext]


def _fake_wav(duration_sec: float = 0.5, sample_rate: int = 16000) -> bytes:
    frames = int(sample_rate * duration_sec)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(b"\x00\x00" * frames)
    return buffer.getvalue()


async def _invoke_model(loaded_module: Any, run_request: RunRequest, ctx: RunContext):
    start = time.perf_counter()
    ctx.logger.info(
        "selftest.invoke",
        extra={"endpoint": run_request.endpoint, "model_id": run_request.model, "phase": "selftest"},
    )
    result = await loaded_module.run(run_request, ctx)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    return result, duration_ms


def _build_run_request(model: LoadedModel, *, stream: bool = False) -> RunRequest:
    endpoint = model.spec.api.endpoint
    model_id = model.spec.id
    if endpoint == "responses":
        payload = {"input": f"Self-test message for {model_id}"}
        if stream:
            payload["stream"] = True
        return RunRequest(endpoint="responses", model=model_id, json=payload, stream=stream)
    if endpoint == "audio.speech":
        return RunRequest(
            endpoint="audio.speech",
            model=model_id,
            json={"input": f"Self-test audio for {model_id}", "response_format": "wav", "stream": stream},
            stream=stream,
        )
    if endpoint in {"audio.transcriptions", "audio.translations"}:
        file_payload = {"filename": "selftest.wav", "content_type": "audio/wav", "data": _fake_wav()}
        form = {"response_format": "json", "temperature": "0"}
        return RunRequest(
            endpoint=endpoint,
            model=model_id,
            form=form,
            files={"file": file_payload},
            stream=stream,
        )
    raise ValueError(f"Unsupported endpoint {endpoint} for self-test")


def _validate_result(endpoint: str, run_request: RunRequest, result: Any, ctx: RunContext) -> None:
    if endpoint == "responses":
        payload = format_responses_create(result, run_request.model or "", request_id=ctx.request_id)
        output = payload.get("output") or []
        if not output:
            raise AssertionError("Responses payload missing output")
        first = output[0]
        contents = first.get("content") or []
        if not contents or contents[0].get("type") != "output_text":
            raise AssertionError("Responses payload missing output_text content")
        return
    if endpoint == "audio.speech":
        if not isinstance(result, (bytes, bytearray)) or not result:
            raise AssertionError("Audio speech result missing audio bytes")
        return
    if endpoint in {"audio.transcriptions", "audio.translations"}:
        if isinstance(result, dict):
            if "text" not in result:
                raise AssertionError("Transcription payload missing 'text'")
            return
        if isinstance(result, str):
            return
    raise AssertionError(f"Unsupported result type for endpoint {endpoint}")


async def run_startup_self_test(
    registry: ModelRegistry,
    defaults: dict[str, str],
    ctx_factory: ContextFactory,
    readiness: ReadinessTracker,
    strict: bool,
) -> None:
    readiness.begin_self_test()
    failed = False
    if not registry.models_by_endpoint:
        readiness.finish_self_test("error" if strict else "degraded")
        return

    target_map: dict[str, list[LoadedModel]] = {}
    for endpoint, model_id in defaults.items():
        if not model_id:
            continue
        loaded_model = registry.get_loaded(model_id)
        if loaded_model:
            target_map.setdefault(endpoint, []).append(loaded_model)

    for endpoint, models in target_map.items():
        if not models:
            readiness.record_self_test_check(endpoint, "skipped", detail="no models configured")
            continue
        for loaded in models:
            ctx = ctx_factory(f"selftest.{endpoint}.{loaded.spec.id}", endpoint, loaded.spec.id)
            try:
                run_request = _build_run_request(loaded, stream=False)
            except ValueError as exc:
                readiness.record_self_test_check(f"{endpoint}:{loaded.spec.id}", "skipped", detail=str(exc))
                continue
            try:
                result, duration_ms = await _invoke_model(loaded.module, run_request, ctx)
                _validate_result(endpoint, run_request, result, ctx)
                readiness.record_self_test_check(f"{endpoint}:{loaded.spec.id}", "ok", duration_ms=duration_ms)
            except Exception as exc:
                failed = True
                readiness.record_self_test_check(f"{endpoint}:{loaded.spec.id}", "error", detail=str(exc))

    # streaming coverage for responses
    responses_stream_model = None
    default_response_id = defaults.get("responses")
    if default_response_id:
        model = registry.get_loaded(default_response_id)
        if model and model.spec.api.supports_stream:
            responses_stream_model = model
    if responses_stream_model:
        ctx = ctx_factory("selftest.responses.stream", "responses", responses_stream_model.spec.id)
        run_request = _build_run_request(responses_stream_model, stream=True)
        try:
            result_stream, duration_ms = await _invoke_model(responses_stream_model.module, run_request, ctx)
            events = []
            async for event in result_stream:
                events.append(event.get("event"))
            if not {"response.output_text.delta", "response.completed"}.issubset(set(events)):
                raise AssertionError("missing response stream events")
            readiness.record_self_test_check("responses_stream", "ok", duration_ms=duration_ms)
        except Exception as exc:
            failed = True
            readiness.record_self_test_check("responses_stream", "error", detail=str(exc))

    # streaming coverage for STT
    stt_stream_model = None
    default_stt_id = defaults.get("audio.transcriptions")
    if default_stt_id:
        model = registry.get_loaded(default_stt_id)
        if model and model.spec.api.supports_stream:
            stt_stream_model = model
    if stt_stream_model:
        ctx_stream = ctx_factory("selftest.audio.transcriptions.stream", "audio.transcriptions", stt_stream_model.spec.id)
        run_request_stream = _build_run_request(stt_stream_model, stream=True)
        try:
            result_stream, duration_ms = await _invoke_model(stt_stream_model.module, run_request_stream, ctx_stream)
            events = []
            async for event in result_stream:
                events.append(event.get("event"))
            if "transcript.text.done" not in events:
                raise AssertionError("missing transcript done event")
            readiness.record_self_test_check("audio_transcriptions_stream", "ok", duration_ms=duration_ms)
        except Exception as exc:
            failed = True
            readiness.record_self_test_check("audio_transcriptions_stream", "error", detail=str(exc))

    final_status = "ok"
    if failed:
        final_status = "error" if strict else "degraded"
    readiness.finish_self_test(final_status)
    if failed and strict:
        raise RuntimeError("Self-tests failed")
