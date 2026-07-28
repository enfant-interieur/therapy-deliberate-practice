from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "tools" / "smoke_native_backends.py"
SPEC = importlib.util.spec_from_file_location("smoke_native_backends", SCRIPT_PATH)
assert SPEC and SPEC.loader
smoke_native_backends = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke_native_backends)

ROOT = Path(__file__).resolve().parents[4]
MODEL_CATALOG = ROOT / "apps" / "web" / "public" / "local-suite" / "models.json"
FAMILY_BY_MODEL_ID = {
    "local//llm/qwen3-hf": "qwen-transformers",
    "local//llm/qwen3-mlx": "qwen-mlx",
    "local//stt/faster-whisper": "faster-whisper",
    "local//stt/parakeet-mlx": "parakeet-mlx",
}
TARGET_BY_PLATFORM = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "windows-x64": "x86_64-pc-windows-msvc",
    "linux-x64": "x86_64-unknown-linux-gnu",
}


def test_native_smoke_covers_every_advertised_packaged_cell() -> None:
    catalog = json.loads(MODEL_CATALOG.read_text("utf-8"))["models"]
    catalog_ids = {model["id"] for model in catalog}
    assert catalog_ids == set(FAMILY_BY_MODEL_ID)

    expected = {target: set() for target in TARGET_BY_PLATFORM.values()}
    for model in catalog:
        family = FAMILY_BY_MODEL_ID[model["id"]]
        for platform in model["compat"]["platforms"]:
            expected[TARGET_BY_PLATFORM[platform]].add(family)

    actual = {
        target: set(families) for target, families in smoke_native_backends.TARGET_BACKEND_FAMILIES.items()
    }
    assert actual == expected
    assert set(actual) == set(smoke_native_backends.SUPPORTED_TARGETS)


@pytest.mark.asyncio
@pytest.mark.parametrize("family", ["qwen-transformers", "qwen-mlx"])
async def test_qwen_native_smoke_rejects_blank_generation(monkeypatch, tmp_path, family) -> None:
    environment_keys = (
        "LOCAL_RUNTIME_QWEN3_HF_MODEL",
        "LOCAL_RUNTIME_QWEN3_HF_REVISION",
        "LOCAL_RUNTIME_QWEN3_HF_DEVICE",
        "LOCAL_RUNTIME_QWEN3_MLX_MODEL",
        "LOCAL_RUNTIME_QWEN3_MLX_REVISION",
    )
    previous_environment = {key: os.environ.get(key) for key in environment_keys}

    async def blank_run(*_args, **_kwargs):
        return {"output_text": " \n\t "}

    if family == "qwen-transformers":
        module = smoke_native_backends.model_llm_qwen3_hf
        smoke = smoke_native_backends.smoke_qwen
        platform = "linux-x64"
    else:

        def fake_snapshot_download(**kwargs):
            Path(kwargs["local_dir"]).mkdir(parents=True, exist_ok=True)
            return kwargs["local_dir"]

        monkeypatch.setitem(
            sys.modules,
            "huggingface_hub",
            SimpleNamespace(snapshot_download=fake_snapshot_download),
        )
        module = smoke_native_backends.model_llm_qwen3_mlx
        smoke = smoke_native_backends.smoke_qwen_mlx
        platform = "darwin-arm64"

    monkeypatch.setattr(module, "load", lambda _context: object())
    monkeypatch.setattr(module, "run", blank_run)

    try:
        with pytest.raises(RuntimeError, match="non-whitespace text"):
            await smoke(tmp_path, platform)
    finally:
        for key, value in previous_environment.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
