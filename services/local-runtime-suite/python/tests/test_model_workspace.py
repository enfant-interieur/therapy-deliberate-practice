from __future__ import annotations

import json
import logging
import threading
from copy import deepcopy
from types import SimpleNamespace

import pytest

from local_runtime.cancellation import ModelBusyError
from local_runtime.core import assets
from local_runtime.core.loader import LoadedModel, load_models
from local_runtime.core.logging import StructuredFormatter
from local_runtime.core.registry import ModelRegistry
from local_runtime.helpers.chat_prompt import prepare_chat_prompt
from local_runtime.main import app
from local_runtime.models import model_template
from local_runtime.spec import ModelSpec


def test_catalog_assets_match_immutable_backend_contracts():
    models = {model.spec.id: model.spec for model in load_models()}
    assert set(models) == set(assets.CATALOG)
    for model_id, entry in assets.CATALOG.items():
        assert models[model_id].backend.revision == entry["revision"]
        assert len(entry["revision"]) == 40
        assert entry["download_bytes"] == sum(file["bytes"] for file in entry["files"])
        assert len({file["name"] for file in entry["files"]}) == len(entry["files"])
        assert entry["license"] in {"apache-2.0", "mit", "cc-by-4.0"}
        assert all(not file["name"].startswith(("/", "..")) for file in entry["files"])


def test_runtime_snapshot_completeness_reuses_read_only_cache(monkeypatch, tmp_path):
    write = tmp_path / "configured"
    existing = tmp_path / "existing"
    entry = {
        "repo": "fixture/model",
        "revision": "f" * 40,
        "files": [{"name": "weights.bin", "bytes": 4}, {"name": "config.json", "bytes": 2}],
        "download_bytes": 6,
    }
    monkeypatch.setattr(assets, "cache_roots", lambda _cache: [write, existing])
    snapshot = existing / "models--fixture--model" / "snapshots" / entry["revision"]
    snapshot.mkdir(parents=True)
    (snapshot / "weights.bin").write_bytes(b"1234")
    assert assets.snapshot_state(entry, str(write))["state"] == "missing"
    (snapshot / "config.json").write_bytes(b"{}")
    state = assets.snapshot_state(entry, str(write))
    assert state["state"] == "cached"
    assert state["completed_bytes"] == 6
    monkeypatch.setitem(assets.CATALOG, "local//fixture", entry)
    assert assets.prepare_assets("local//fixture", str(write)) == str(snapshot)
    assert not write.exists()
    (snapshot / "weights.bin").write_bytes(b"bad")
    assert assets.snapshot_state(entry, str(write))["state"] == "missing"


def test_chat_prompt_preserves_instructions_roles_and_text_content():
    calls = []
    tokenizer = SimpleNamespace(
        chat_template="template",
        apply_chat_template=lambda messages, **kwargs: calls.append((messages, kwargs)) or "templated",
    )
    assert (
        prepare_chat_prompt(
            {
                "instructions": "Training only.",
                "input": [
                    {"role": "assistant", "content": [{"type": "output_text", "text": "Previous response"}]},
                    {"role": "user", "content": [{"type": "input_text", "text": "Continue"}]},
                ],
            },
            tokenizer,
        )
        == "templated"
    )
    assert calls[0][0] == [
        {"role": "system", "content": "Training only."},
        {"role": "assistant", "content": "Previous response"},
        {"role": "user", "content": "Continue"},
    ]
    assert calls[0][1]["enable_thinking"] is False
    with pytest.raises(ValueError, match="text messages only"):
        prepare_chat_prompt({"input": [{"type": "input_image", "image_url": "private"}]}, tokenizer)


def test_exception_logging_excludes_backend_content():
    secret = "never_log_therapy_or_keys"
    try:
        raise RuntimeError(secret)
    except RuntimeError:
        import sys

        record = logging.LogRecord("test", logging.ERROR, "", 1, "model.failed", (), sys.exc_info())
        record.error = secret
    payload = json.loads(StructuredFormatter().format(record))
    assert secret not in json.dumps(payload)
    assert payload["exception_type"] == "RuntimeError"


@pytest.mark.asyncio
async def test_mlx_repeated_delta_is_not_dropped(monkeypatch):
    import sys

    from local_runtime.models import model_llm_qwen3_mlx as adapter

    monkeypatch.setitem(
        sys.modules,
        "mlx_lm",
        SimpleNamespace(
            stream_generate=lambda *_args, **_kwargs: iter(
                [SimpleNamespace(text="ha"), SimpleNamespace(text="ha")]
            )
        ),
    )
    monkeypatch.setattr(adapter, "_build_sampling_components", lambda _params: (None, []))
    assert (
        await adapter._generate_text(
            {"model": object(), "tokenizer": object(), "lock": threading.Lock()},
            "synthetic",
            adapter._generation_params({}),
            None,
        )
        == "haha"
    )


@pytest.mark.asyncio
async def test_unload_rejects_active_loading_and_finishing_requests():
    raw = deepcopy(model_template.SPEC)
    raw["id"] = "local//fixture/release"
    spec = ModelSpec.model_validate(raw)
    registry = ModelRegistry(
        [LoadedModel("fixture", SimpleNamespace(), spec)], "test", logging.getLogger("test")
    )
    lock = threading.Lock()
    registry.model_instances[spec.id] = {"lock": lock}
    registry.active_models["request"] = spec.id
    with pytest.raises(ModelBusyError):
        await registry.unload(spec.id)
    registry.active_models.clear()
    registry._load_tasks[spec.id] = object()
    with pytest.raises(ModelBusyError):
        await registry.unload(spec.id)
    registry._load_tasks.clear()
    lock.acquire()
    with pytest.raises(ModelBusyError):
        await registry.unload(spec.id)
    lock.release()
    assert await registry.unload(spec.id)
    assert not await registry.unload(spec.id)


def test_new_routes_require_capability_and_intel_speech_only_settings(client):
    assert client.get("/runtime/models", headers={"Authorization": ""}).status_code == 401
    assert (
        client.post(
            "/runtime/models/unload", headers={"Authorization": ""}, json={"model": "local//llm/qwen3-mlx"}
        ).status_code
        == 401
    )
    assert client.post("/load_models", json=[]).status_code == 400
    assert client.post("/runtime/config", json=[]).status_code == 400
    assert client.post("/runtime/models/unload", json=[]).status_code == 400
    app.state.registry.platform_id = "darwin-x64"
    assert client.post("/load_models", json={"models": ["local//llm/qwen3-hf"]}).status_code == 400
    result = client.post(
        "/runtime/config", json={"default_models": {"audio.transcriptions": "local//stt/faster-whisper"}}
    )
    assert result.status_code == 200
    assert result.json()["default_models"] == {"audio.transcriptions": "local//stt/faster-whisper"}


@pytest.mark.asyncio
async def test_parakeet_load_and_transcription_share_a_worker_and_retain_cancelled_lock(monkeypatch):
    import asyncio

    from local_runtime.models import model_stt_parakeet_mlx as adapter

    started = threading.Event()
    finish = threading.Event()
    lock = threading.Lock()
    threads = []

    def construct(_ctx):
        threads.append(threading.get_ident())

        def transcribe(*_args, **_kwargs):
            threads.append(threading.get_ident())
            started.set()
            assert finish.wait(2)
            return "synthetic"

        return {"model": SimpleNamespace(transcribe=transcribe), "lock": lock}

    monkeypatch.setattr(adapter, "_load_on_worker", construct)
    instance = await asyncio.to_thread(adapter.load, None)
    task = asyncio.create_task(adapter._run_transcribe(instance, "synthetic.wav", 120, 15, None))
    assert await asyncio.to_thread(started.wait, 2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert lock.locked()
    finish.set()
    for _ in range(100):
        if not lock.locked():
            break
        await asyncio.sleep(0.01)
    assert not lock.locked()
    assert threads[0] == threads[1]


@pytest.mark.asyncio
async def test_stream_failure_is_sanitized_and_releases_request_bookkeeping(monkeypatch):
    import importlib

    gateway = importlib.import_module("local_runtime.main")
    cleanup = []

    async def finish(*args):
        cleanup.append(args)

    async def failing_source():
        yield {"event": "response.created", "data": {}}
        raise RuntimeError("private_transcript_and_key")

    monkeypatch.setattr(gateway, "_finish_inference", finish)
    events = [
        event async for event in gateway._finalize_inference_stream(failing_source(), "synthetic", None, None)
    ]
    assert events[-1]["event"] == "error"
    assert events[-1]["data"]["error"]["status"] == 500
    assert "private_transcript_and_key" not in json.dumps(events)
    assert cleanup == [("synthetic", None, None)]
