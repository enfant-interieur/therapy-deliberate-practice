from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from local_runtime.helpers.multipart_helpers import UploadedFile
from local_runtime.models import (
    model_llm_qwen3_hf,
    model_llm_qwen3_mlx,
    model_stt_faster_whisper,
    model_stt_parakeet_mlx,
)


class TrackingLock:
    def __init__(self) -> None:
        self.held = False

    def __enter__(self):
        assert self.acquire()
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.release()

    def acquire(self, timeout: float | None = None) -> bool:
        del timeout
        if self.held:
            return False
        self.held = True
        return True

    def release(self) -> None:
        assert self.held
        self.held = False


class CapturingLogger:
    def __init__(self) -> None:
        self.extras: list[dict] = []

    def info(self, _message, *, extra=None) -> None:
        self.extras.append(extra or {})

    def exception(self, _message, *, extra=None) -> None:
        self.extras.append(extra or {})


def test_qwen_generation_parameters_are_bounded_and_use_instruct_defaults() -> None:
    hf = model_llm_qwen3_hf._generation_params(
        {
            "max_output_tokens": 999_999,
            "temperature": -3,
            "top_p": 4,
            "top_k": 999,
        }
    )
    mlx = model_llm_qwen3_mlx._generation_params(
        {
            "max_output_tokens": -2,
            "temperature": "invalid",
            "top_p": 0,
            "top_k": -8,
            "repetition_penalty": 9,
        }
    )

    assert hf == {
        "max_new_tokens": model_llm_qwen3_hf.SPEC["limits"]["max_output_tokens_default"] * 4,
        "temperature": 0.0,
        "top_p": 1.0,
        "top_k": 100,
    }
    assert mlx == {
        "max_tokens": 1,
        "temperature": model_llm_qwen3_mlx.DEFAULT_TEMPERATURE,
        "top_p": 0.01,
        "top_k": 1,
        "repetition_penalty": 2.0,
    }
    assert model_llm_qwen3_hf.DEFAULT_TOP_P == 0.8
    assert model_llm_qwen3_hf.DEFAULT_TOP_K == 20
    assert model_llm_qwen3_mlx.DEFAULT_TOP_P == 0.8
    assert model_llm_qwen3_mlx.DEFAULT_TOP_K == 20
    assert model_llm_qwen3_mlx.SPEC["backend"]["model_ref"] == "mlx-community/Qwen3-4B-Instruct-2507-4bit"


def test_default_model_revisions_are_immutable_commits() -> None:
    revisions = {
        model_llm_qwen3_hf.SPEC["backend"]["revision"],
        model_llm_qwen3_mlx.SPEC["backend"]["revision"],
        model_stt_faster_whisper.SPEC["backend"]["revision"],
        model_stt_parakeet_mlx.SPEC["backend"]["revision"],
    }

    assert all(
        isinstance(revision, str) and len(revision) == 40 and set(revision) <= set("0123456789abcdef")
        for revision in revisions
    )


def test_qwen_hf_load_applies_an_immutable_test_revision(monkeypatch, tmp_path) -> None:
    calls: list[tuple[str, str, dict]] = []

    class LoadedModel:
        def to(self, _device):
            return self

        def eval(self):
            return self

    class AutoTokenizer:
        @staticmethod
        def from_pretrained(model_ref, **kwargs):
            calls.append(("tokenizer", model_ref, kwargs))
            return object()

    class AutoModel:
        @staticmethod
        def from_pretrained(model_ref, **kwargs):
            calls.append(("model", model_ref, kwargs))
            return LoadedModel()

    monkeypatch.setenv("LOCAL_RUNTIME_QWEN3_HF_MODEL", "tiny-random/qwen3")
    monkeypatch.setenv("LOCAL_RUNTIME_QWEN3_HF_REVISION", "immutable-revision")
    monkeypatch.setattr(
        model_llm_qwen3_hf,
        "_load_backend",
        lambda: (object(), AutoModel, AutoTokenizer, object()),
    )
    monkeypatch.setattr(model_llm_qwen3_hf, "_select_device", lambda: "cpu")
    context = SimpleNamespace(
        logger=SimpleNamespace(info=lambda *_args, **_kwargs: None),
        cache_dir=str(tmp_path),
    )

    instance = model_llm_qwen3_hf.load(context)

    assert instance["model_ref"] == "tiny-random/qwen3"
    assert instance["revision"] == "immutable-revision"
    assert calls == [
        (
            "tokenizer",
            "tiny-random/qwen3",
            {
                "revision": "immutable-revision",
                "trust_remote_code": False,
                "cache_dir": str(tmp_path),
            },
        ),
        (
            "model",
            "tiny-random/qwen3",
            {
                "revision": "immutable-revision",
                "trust_remote_code": False,
                "torch_dtype": "auto",
                "cache_dir": str(tmp_path),
            },
        ),
    ]


def test_qwen_mlx_load_applies_the_pinned_revision(monkeypatch, tmp_path) -> None:
    calls = []
    snapshot_calls = []
    resolved = tmp_path / "cache" / "snapshot"

    def mlx_load(model_ref, **kwargs):
        calls.append((model_ref, kwargs))
        return object(), object()

    def snapshot_download(**kwargs):
        snapshot_calls.append(kwargs)
        return str(resolved)

    monkeypatch.setitem(sys.modules, "mlx_lm", SimpleNamespace(load=mlx_load))
    monkeypatch.setitem(
        sys.modules,
        "huggingface_hub",
        SimpleNamespace(snapshot_download=snapshot_download),
    )
    context = SimpleNamespace(
        logger=SimpleNamespace(info=lambda *_args, **_kwargs: None),
        cache_dir=str(tmp_path / "cache"),
    )

    instance = model_llm_qwen3_mlx.load(context)

    assert instance["revision"] == model_llm_qwen3_mlx.SPEC["backend"]["revision"]
    assert snapshot_calls == [
        {
            "repo_id": model_llm_qwen3_mlx.SPEC["backend"]["model_ref"],
            "revision": model_llm_qwen3_mlx.SPEC["backend"]["revision"],
            "cache_dir": str(tmp_path / "cache"),
        }
    ]
    assert calls == [
        (
            str(resolved),
            {"revision": model_llm_qwen3_mlx.SPEC["backend"]["revision"]},
        )
    ]


def test_qwen_warmup_logs_are_metadata_only(monkeypatch) -> None:
    class InferenceMode:
        def __enter__(self):
            return self

        def __exit__(self, _exc_type, _exc, _traceback) -> None:
            return None

    class FakeTorch:
        @staticmethod
        def inference_mode():
            return InferenceMode()

    class Inputs(dict):
        def to(self, _device):
            return self

    class Tokenizer:
        def __call__(self, _prompt, **_kwargs):
            return Inputs()

    class Model:
        def generate(self, **_kwargs):
            return None

    hf_logger = CapturingLogger()
    monkeypatch.setattr(
        model_llm_qwen3_hf,
        "_load_backend",
        lambda: (FakeTorch(), object(), object(), object()),
    )
    model_llm_qwen3_hf.warmup(
        {
            "tokenizer": Tokenizer(),
            "model": Model(),
            "device": "cpu",
            "lock": TrackingLock(),
        },
        SimpleNamespace(logger=hf_logger),
    )

    mlx_logger = CapturingLogger()
    monkeypatch.setitem(
        sys.modules,
        "mlx_lm",
        SimpleNamespace(generate=lambda *_args, **_kwargs: "ok"),
    )
    monkeypatch.setattr(
        model_llm_qwen3_mlx,
        "_build_sampling_components",
        lambda _params: ("sampler", []),
    )
    model_llm_qwen3_mlx.warmup(
        {
            "model": object(),
            "tokenizer": object(),
            "lock": TrackingLock(),
        },
        SimpleNamespace(logger=mlx_logger),
    )

    assert hf_logger.extras
    assert mlx_logger.extras
    assert all("prompt" not in extra for extra in hf_logger.extras)
    assert all("prompt" not in extra for extra in mlx_logger.extras)


@pytest.mark.asyncio
async def test_qwen_mlx_non_streaming_generation_holds_the_model_lock(monkeypatch) -> None:
    lock = TrackingLock()

    def stream_generate(*_args, **_kwargs):
        assert lock.held
        yield SimpleNamespace(text="safe response")

    monkeypatch.setitem(sys.modules, "mlx_lm", SimpleNamespace(stream_generate=stream_generate))
    monkeypatch.setattr(
        model_llm_qwen3_mlx,
        "_build_sampling_components",
        lambda _params: ("sampler", ["processor"]),
    )

    result = await model_llm_qwen3_mlx._generate_text(
        {"model": object(), "tokenizer": object(), "lock": lock},
        "prompt",
        model_llm_qwen3_mlx._generation_params({}),
    )

    assert result == "safe response"
    assert not lock.held


@pytest.mark.asyncio
async def test_qwen_mlx_streaming_generation_holds_the_model_lock(monkeypatch) -> None:
    lock = TrackingLock()

    def stream_generate(*_args, **_kwargs):
        assert lock.held
        yield SimpleNamespace(text="safe")
        assert lock.held
        yield SimpleNamespace(text="safe response")

    monkeypatch.setitem(sys.modules, "mlx_lm", SimpleNamespace(stream_generate=stream_generate))
    monkeypatch.setattr(
        model_llm_qwen3_mlx,
        "_build_sampling_components",
        lambda _params: ("sampler", ["processor"]),
    )

    stream = await model_llm_qwen3_mlx._generate_stream(
        {"model": object(), "tokenizer": object(), "lock": lock},
        "prompt",
        model_llm_qwen3_mlx._generation_params({}),
    )
    chunks = [chunk async for chunk in stream]

    assert chunks == ["safe", " response"]
    assert not lock.held


def test_parakeet_temp_audio_uses_safe_suffix_and_private_random_file(tmp_path) -> None:
    upload = UploadedFile(
        filename="recording../../secret.txt.exe",
        content_type="application/octet-stream",
        data=b"audio",
    )

    path = model_stt_parakeet_mlx._write_temp_audio(upload, str(tmp_path))

    assert path.startswith(str(tmp_path))
    assert path.endswith(".exe")
    assert Path(path).read_bytes() == b"audio"
    assert Path(path).stat().st_mode & 0o077 == 0


def test_parakeet_transcription_windows_are_bounded() -> None:
    assert model_stt_parakeet_mlx._normalise_transcribe_window("invalid", None) == (
        model_stt_parakeet_mlx.DEFAULT_CHUNK_SECONDS,
        model_stt_parakeet_mlx.DEFAULT_OVERLAP_SECONDS,
    )
    assert model_stt_parakeet_mlx._normalise_transcribe_window(-5, 999) == (10.0, 5.0)
    assert model_stt_parakeet_mlx._normalise_transcribe_window(9999, -4) == (600.0, 0.0)


def test_parakeet_activates_packaged_ffmpeg_without_a_system_install(monkeypatch, tmp_path) -> None:
    bundled = tmp_path / "bundled-ffmpeg"
    bundled.write_bytes(b"packaged-ffmpeg")
    shim = tmp_path / "cache" / "parakeet-ffmpeg" / "ffmpeg"
    monkeypatch.setitem(
        sys.modules,
        "imageio_ffmpeg",
        SimpleNamespace(get_ffmpeg_exe=lambda: str(bundled)),
    )
    monkeypatch.setattr(
        model_stt_parakeet_mlx.shutil,
        "which",
        lambda _name: str(shim) if shim.is_file() else None,
    )
    monkeypatch.setenv("PATH", "/usr/bin")

    resolved = model_stt_parakeet_mlx._ensure_ffmpeg_available(str(tmp_path / "cache"))

    assert resolved == str(shim)
    assert shim.read_bytes() == b"packaged-ffmpeg"
    assert shim.stat().st_mode & 0o077 == 0
    assert os.environ["PATH"].split(os.pathsep)[0] == str(shim.parent)


def test_parakeet_resolves_only_the_pinned_model_snapshot(monkeypatch, tmp_path) -> None:
    calls = []
    resolved = tmp_path / "snapshot"

    def snapshot_download(**kwargs):
        calls.append(kwargs)
        return str(resolved)

    monkeypatch.setitem(
        sys.modules,
        "huggingface_hub",
        SimpleNamespace(snapshot_download=snapshot_download),
    )

    result = model_stt_parakeet_mlx._resolve_model_path(
        model_stt_parakeet_mlx.SPEC["backend"]["model_ref"],
        model_stt_parakeet_mlx.SPEC["backend"]["revision"],
        str(tmp_path / "cache"),
    )

    assert result == str(resolved)
    assert calls == [
        {
            "repo_id": model_stt_parakeet_mlx.SPEC["backend"]["model_ref"],
            "revision": model_stt_parakeet_mlx.SPEC["backend"]["revision"],
            "cache_dir": str(tmp_path / "cache"),
            "allow_patterns": ["config.json", "model.safetensors"],
        }
    ]


@pytest.mark.asyncio
async def test_parakeet_transcription_holds_the_model_lock() -> None:
    lock = TrackingLock()

    class Model:
        def transcribe(self, path, **kwargs):
            assert lock.held
            assert path == "/tmp/audio.wav"
            assert kwargs["chunk_duration"] == 120
            return "transcribed"

    result = await model_stt_parakeet_mlx._run_transcribe(
        {"model": Model(), "lock": lock},
        "/tmp/audio.wav",
        chunk_duration=120,
        overlap_duration=15,
        decoding_config=None,
    )

    assert result == "transcribed"
    assert not lock.held
