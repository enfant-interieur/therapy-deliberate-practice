from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.metadata
import io
import json
import logging
import math
import os
import platform
import sys
import time
import wave
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

PYTHON_PROJECT_ROOT = Path(__file__).resolve().parents[1]
PACKAGED_RUNTIME_ROOT = (
    Path(os.environ["LOCAL_RUNTIME_PACKAGED_ROOT"]).resolve()
    if os.environ.get("LOCAL_RUNTIME_PACKAGED_ROOT")
    else None
)
IMPORT_ROOT = PACKAGED_RUNTIME_ROOT / "pylibs" if PACKAGED_RUNTIME_ROOT else PYTHON_PROJECT_ROOT
if str(IMPORT_ROOT) not in sys.path:
    sys.path.insert(0, str(IMPORT_ROOT))

from local_runtime.models import (
    model_llm_qwen3_hf,
    model_llm_qwen3_mlx,
    model_stt_faster_whisper,
    model_stt_parakeet_mlx,
)
from local_runtime.runtime_types import RunContext, RunRequest

QWEN_FIXTURE = "tiny-random/qwen3"
QWEN_FIXTURE_REVISION = "84ad45b4ecda2d4849aac0b768d520c239ff5875"
FASTER_WHISPER_FIXTURE = "Systran/faster-whisper-base"
FASTER_WHISPER_FIXTURE_REVISION = "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66"
QWEN_MLX_FIXTURE = "mlx-community/Qwen3-0.6B-4bit"
QWEN_MLX_FIXTURE_REVISION = "73e3e38d981303bc594367cd910ea6eb48349da8"
PARAKEET_MLX_FIXTURE = "mlx-community/parakeet-tdt_ctc-110m"
PARAKEET_MLX_FIXTURE_REVISION = "d62547387c356a1ab6bb3d85d98b2103f655282e"
SUPPORTED_TARGETS = {
    "aarch64-apple-darwin": {
        "system": "Darwin",
        "machines": {"arm64", "aarch64"},
        "platform_id": "darwin-arm64",
    },
    "x86_64-apple-darwin": {
        "system": "Darwin",
        "machines": {"x86_64"},
        "platform_id": "darwin-x64",
    },
    "x86_64-pc-windows-msvc": {
        "system": "Windows",
        "machines": {"amd64", "x86_64"},
        "platform_id": "windows-x64",
    },
    "x86_64-unknown-linux-gnu": {
        "system": "Linux",
        "machines": {"amd64", "x86_64"},
        "platform_id": "linux-x64",
    },
}
TARGET_BACKEND_FAMILIES = {
    "aarch64-apple-darwin": (
        "qwen-transformers",
        "faster-whisper",
        "qwen-mlx",
        "parakeet-mlx",
    ),
    "x86_64-apple-darwin": ("faster-whisper",),
    "x86_64-pc-windows-msvc": ("qwen-transformers", "faster-whisper"),
    "x86_64-unknown-linux-gnu": ("qwen-transformers", "faster-whisper"),
}


class FixedRegistry:
    def __init__(self, instance: Any):
        self.instance = instance

    async def ensure_instance(self, _model_id: str, _ctx: RunContext) -> Any:
        return self.instance


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def package_version(name: str) -> str:
    return importlib.metadata.version(name)


def file_manifest(root: Path) -> list[dict[str, Any]]:
    return [
        {
            "path": relative.as_posix(),
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        }
        for path in sorted(root.rglob("*"))
        if path.is_file()
        and not path.is_symlink()
        and path.stat().st_size > 0
        and ".cache" not in (relative := path.relative_to(root)).parts
    ]


def audio_fixture() -> bytes:
    rate = 16_000
    output = io.BytesIO()
    with wave.open(output, "wb") as handle:
        handle.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        samples = bytearray()
        for index in range(rate):
            value = int(5000 * math.sin(2 * math.pi * 440 * index / rate))
            samples.extend(value.to_bytes(2, "little", signed=True))
        handle.writeframes(bytes(samples))
    return output.getvalue()


def context(
    cache_dir: Path,
    platform_id: str,
    registry: FixedRegistry | None = None,
) -> RunContext:
    logger = logging.getLogger("native-backend-smoke")
    logger.setLevel(logging.INFO)
    logger.addHandler(logging.StreamHandler())
    return RunContext(
        request_id="native-backend-smoke",
        logger=logger,
        data_dir=str(cache_dir / "data"),
        cache_dir=str(cache_dir / "cache"),
        platform=platform_id,
        registry=registry,  # type: ignore[arg-type]
        http_client=None,
    )


async def smoke_qwen(cache_dir: Path, platform_id: str) -> dict[str, Any]:
    os.environ["LOCAL_RUNTIME_QWEN3_HF_MODEL"] = QWEN_FIXTURE
    os.environ["LOCAL_RUNTIME_QWEN3_HF_REVISION"] = QWEN_FIXTURE_REVISION
    os.environ["LOCAL_RUNTIME_QWEN3_HF_DEVICE"] = "cpu"
    prompt = "Return one short test response."
    base_context = context(cache_dir, platform_id)
    started = time.perf_counter()
    instance = await asyncio.to_thread(model_llm_qwen3_hf.load, base_context)
    loaded = time.perf_counter()
    request = RunRequest(
        endpoint="responses",
        model=model_llm_qwen3_hf.SPEC["id"],
        json={"input": prompt, "max_output_tokens": 8, "temperature": 0},
        stream=False,
    )
    result = await model_llm_qwen3_hf.run(
        request,
        context(cache_dir, platform_id, FixedRegistry(instance)),
    )
    finished = time.perf_counter()
    if not isinstance(result, dict) or not isinstance(result.get("output_text"), str):
        raise TypeError("Qwen native smoke did not return a Responses text payload.")
    output_text = result["output_text"].strip()
    if not output_text:
        raise RuntimeError("Qwen native smoke returned no non-whitespace text.")
    return {
        "family": "qwen-transformers",
        "result": "passed",
        "model_ref": QWEN_FIXTURE,
        "revision": QWEN_FIXTURE_REVISION,
        "packages": {
            "accelerate": package_version("accelerate"),
            "torch": package_version("torch"),
            "transformers": package_version("transformers"),
        },
        "request_shape": {
            "endpoint": "responses",
            "stream": False,
            "max_output_tokens": 8,
            "temperature": 0,
            "input_sha256": sha256(prompt.encode()),
        },
        "output": {
            "type": type(result).__name__,
            "keys": sorted(result),
            "text_chars": len(output_text),
        },
        "timing_ms": {
            "load": round((loaded - started) * 1000, 2),
            "request": round((finished - loaded) * 1000, 2),
        },
    }


async def smoke_faster_whisper(cache_dir: Path, platform_id: str) -> dict[str, Any]:
    from huggingface_hub import snapshot_download

    model_root = cache_dir / "faster-whisper-base"
    await asyncio.to_thread(
        snapshot_download,
        repo_id=FASTER_WHISPER_FIXTURE,
        revision=FASTER_WHISPER_FIXTURE_REVISION,
        local_dir=model_root,
    )
    os.environ["LOCAL_RUNTIME_FASTER_WHISPER_MODEL"] = str(model_root)
    os.environ["LOCAL_RUNTIME_FASTER_WHISPER_DEVICE"] = "cpu"
    audio = audio_fixture()
    base_context = context(cache_dir, platform_id)
    started = time.perf_counter()
    instance = await asyncio.to_thread(model_stt_faster_whisper.load, base_context)
    loaded = time.perf_counter()
    request = RunRequest(
        endpoint="audio.transcriptions",
        model=model_stt_faster_whisper.SPEC["id"],
        form={"language": "en"},
        files={
            "file": {
                "filename": "deterministic-tone.wav",
                "content_type": "audio/wav",
                "data": audio,
            }
        },
        stream=False,
    )
    result = await model_stt_faster_whisper.run(
        request,
        context(cache_dir, platform_id, FixedRegistry(instance)),
    )
    finished = time.perf_counter()
    if not isinstance(result, dict) or not isinstance(result.get("text"), str):
        raise TypeError("Faster Whisper native smoke did not return a transcription payload.")
    return {
        "family": "faster-whisper",
        "result": "passed",
        "model_ref": FASTER_WHISPER_FIXTURE,
        "revision": FASTER_WHISPER_FIXTURE_REVISION,
        "model_files": file_manifest(model_root),
        "packages": {
            "faster-whisper": package_version("faster-whisper"),
            "ctranslate2": package_version("ctranslate2"),
        },
        "request_shape": {
            "endpoint": "audio.transcriptions",
            "stream": False,
            "language": "en",
            "input_sha256": sha256(audio),
        },
        "output": {
            "type": type(result).__name__,
            "keys": sorted(result),
            "text_chars": len(result["text"]),
            "segments": len(result.get("segments") or []),
        },
        "timing_ms": {
            "load": round((loaded - started) * 1000, 2),
            "request": round((finished - loaded) * 1000, 2),
        },
    }


async def smoke_qwen_mlx(cache_dir: Path, platform_id: str) -> dict[str, Any]:
    from huggingface_hub import snapshot_download

    model_root = cache_dir / "qwen3-0.6b-4bit"
    await asyncio.to_thread(
        snapshot_download,
        repo_id=QWEN_MLX_FIXTURE,
        revision=QWEN_MLX_FIXTURE_REVISION,
        local_dir=model_root,
    )
    os.environ["LOCAL_RUNTIME_QWEN3_MLX_MODEL"] = str(model_root)
    os.environ["LOCAL_RUNTIME_QWEN3_MLX_REVISION"] = QWEN_MLX_FIXTURE_REVISION
    prompt = "Return one short test response."
    base_context = context(cache_dir, platform_id)
    started = time.perf_counter()
    instance = await asyncio.to_thread(model_llm_qwen3_mlx.load, base_context)
    loaded = time.perf_counter()
    request = RunRequest(
        endpoint="responses",
        model=model_llm_qwen3_mlx.SPEC["id"],
        json={"input": prompt, "max_output_tokens": 8, "temperature": 0},
        stream=False,
    )
    result = await model_llm_qwen3_mlx.run(
        request,
        context(cache_dir, platform_id, FixedRegistry(instance)),
    )
    finished = time.perf_counter()
    if not isinstance(result, dict) or not isinstance(result.get("output_text"), str):
        raise TypeError("Qwen MLX native smoke did not return a Responses text payload.")
    output_text = result["output_text"].strip()
    if not output_text:
        raise RuntimeError("Qwen MLX native smoke returned no non-whitespace text.")
    return {
        "family": "qwen-mlx",
        "result": "passed",
        "model_ref": QWEN_MLX_FIXTURE,
        "revision": QWEN_MLX_FIXTURE_REVISION,
        "model_files": file_manifest(model_root),
        "packages": {
            "mlx": package_version("mlx"),
            "mlx-lm": package_version("mlx-lm"),
        },
        "request_shape": {
            "endpoint": "responses",
            "stream": False,
            "max_output_tokens": 8,
            "temperature": 0,
            "input_sha256": sha256(prompt.encode()),
        },
        "output": {
            "type": type(result).__name__,
            "keys": sorted(result),
            "text_chars": len(output_text),
        },
        "timing_ms": {
            "load": round((loaded - started) * 1000, 2),
            "request": round((finished - loaded) * 1000, 2),
        },
    }


async def smoke_parakeet_mlx(cache_dir: Path, platform_id: str) -> dict[str, Any]:
    from huggingface_hub import snapshot_download

    model_root = cache_dir / "parakeet-tdt-ctc-110m"
    await asyncio.to_thread(
        snapshot_download,
        repo_id=PARAKEET_MLX_FIXTURE,
        revision=PARAKEET_MLX_FIXTURE_REVISION,
        local_dir=model_root,
        allow_patterns=["config.json", "model.safetensors"],
    )
    os.environ["LOCAL_RUNTIME_STT_MODEL"] = str(model_root)
    os.environ["LOCAL_RUNTIME_STT_REVISION"] = PARAKEET_MLX_FIXTURE_REVISION
    audio = audio_fixture()
    base_context = context(cache_dir, platform_id)
    started = time.perf_counter()
    instance = await asyncio.to_thread(model_stt_parakeet_mlx.load, base_context)
    loaded = time.perf_counter()
    request = RunRequest(
        endpoint="audio.transcriptions",
        model=model_stt_parakeet_mlx.SPEC["id"],
        form={"language": "en", "chunk_duration": 10, "overlap_duration": 0},
        files={
            "file": {
                "filename": "deterministic-tone.wav",
                "content_type": "audio/wav",
                "data": audio,
            }
        },
        stream=False,
    )
    result = await model_stt_parakeet_mlx.run(
        request,
        context(cache_dir, platform_id, FixedRegistry(instance)),
    )
    finished = time.perf_counter()
    if not isinstance(result, dict) or not isinstance(result.get("text"), str):
        raise TypeError("Parakeet MLX native smoke did not return a transcription payload.")
    return {
        "family": "parakeet-mlx",
        "result": "passed",
        "model_ref": PARAKEET_MLX_FIXTURE,
        "revision": PARAKEET_MLX_FIXTURE_REVISION,
        "model_files": file_manifest(model_root),
        "packages": {
            "imageio-ffmpeg": package_version("imageio-ffmpeg"),
            "mlx": package_version("mlx"),
            "parakeet-mlx": package_version("parakeet-mlx"),
        },
        "request_shape": {
            "endpoint": "audio.transcriptions",
            "stream": False,
            "language": "en",
            "chunk_duration": 10,
            "overlap_duration": 0,
            "input_sha256": sha256(audio),
        },
        "output": {
            "type": type(result).__name__,
            "keys": sorted(result),
            "text_chars": len(result["text"]),
            "segments": len(result.get("segments") or []),
        },
        "timing_ms": {
            "load": round((loaded - started) * 1000, 2),
            "request": round((finished - loaded) * 1000, 2),
        },
    }


async def run(output_path: Path) -> None:
    target = os.environ.get("RUNNER_TARGET", "")
    target_config = SUPPORTED_TARGETS.get(target)
    if target_config is None:
        raise RuntimeError(
            "Native backend smoke requires RUNNER_TARGET to identify a supported ARM macOS, "
            "Windows, or Linux release target."
        )
    actual_system = platform.system()
    actual_machine = platform.machine().lower()
    if actual_system != target_config["system"] or actual_machine not in target_config["machines"]:
        raise RuntimeError(
            f"Native backend smoke target {target} does not match this host "
            f"({actual_system} {platform.machine()})."
        )
    cache_dir = Path(
        os.environ.get(
            "LOCAL_RUNTIME_NATIVE_SMOKE_CACHE",
            str(output_path.parent / "native-backend-cache"),
        )
    ).resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)
    platform_id = str(target_config["platform_id"])
    smoke_by_family = {
        "qwen-transformers": smoke_qwen,
        "faster-whisper": smoke_faster_whisper,
        "qwen-mlx": smoke_qwen_mlx,
        "parakeet-mlx": smoke_parakeet_mlx,
    }
    module_by_family = {
        "qwen-transformers": model_llm_qwen3_hf,
        "faster-whisper": model_stt_faster_whisper,
        "qwen-mlx": model_llm_qwen3_mlx,
        "parakeet-mlx": model_stt_parakeet_mlx,
    }
    selected_families = TARGET_BACKEND_FAMILIES[target]
    results = [await smoke_by_family[family](cache_dir, platform_id) for family in selected_families]
    selected_modules = tuple(module_by_family[family] for family in selected_families)
    runtime_provenance = None
    if PACKAGED_RUNTIME_ROOT:
        provenance_path = PACKAGED_RUNTIME_ROOT / "build-provenance.json"
        if not provenance_path.is_file():
            raise RuntimeError(f"Packaged runtime provenance is missing: {provenance_path}.")
        runtime_provenance = json.loads(provenance_path.read_text("utf-8"))
        for module in selected_modules:
            module_path = Path(module.__file__).resolve()
            if IMPORT_ROOT.resolve() not in module_path.parents:
                raise RuntimeError(
                    f"Native smoke imported {module.__name__} outside the packaged payload: {module_path}."
                )
    receipt = {
        "schema_version": 1,
        "recorded_at": datetime.now(UTC).isoformat(),
        "result": "passed",
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": platform.python_version(),
            "target": target,
        },
        "source": {
            "git_sha": os.environ.get("BUILD_SOURCE_SHA") or os.environ.get("GITHUB_SHA"),
            "runner_sha256": sha256(Path(__file__).read_bytes()),
            "qwen_adapter_sha256": sha256(Path(model_llm_qwen3_hf.__file__).read_bytes()),
            "qwen_mlx_adapter_sha256": sha256(Path(model_llm_qwen3_mlx.__file__).read_bytes()),
            "faster_whisper_adapter_sha256": sha256(Path(model_stt_faster_whisper.__file__).read_bytes()),
            "parakeet_mlx_adapter_sha256": sha256(Path(model_stt_parakeet_mlx.__file__).read_bytes()),
        },
        "runtime_provenance": runtime_provenance,
        "backends": results,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    print(json.dumps(receipt, indent=2, sort_keys=True))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    asyncio.run(run(arguments.output.resolve()))


if __name__ == "__main__":
    main()
