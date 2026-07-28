from __future__ import annotations

import re
from typing import Any

SHA256 = re.compile(r"^[a-f0-9]{64}$")
NATIVE_BACKEND_TARGETS = {
    "aarch64-apple-darwin": {
        "system": "Darwin",
        "machines": {"arm64", "aarch64"},
        "families": {
            "qwen-transformers",
            "faster-whisper",
            "qwen-mlx",
            "parakeet-mlx",
        },
    },
    "x86_64-apple-darwin": {
        "system": "Darwin",
        "machines": {"x86_64"},
        "families": {"faster-whisper"},
    },
    "x86_64-pc-windows-msvc": {
        "system": "Windows",
        "machines": {"amd64", "x86_64"},
        "families": {"qwen-transformers", "faster-whisper"},
    },
    "x86_64-unknown-linux-gnu": {
        "system": "Linux",
        "machines": {"amd64", "x86_64"},
        "families": {"qwen-transformers", "faster-whisper"},
    },
}
NATIVE_BACKEND_FIXTURES = {
    "qwen-transformers": {
        "model_ref": "tiny-random/qwen3",
        "revision": "84ad45b4ecda2d4849aac0b768d520c239ff5875",
        "packages": {"accelerate", "torch", "transformers"},
        "endpoint": "responses",
        "has_model_files": False,
    },
    "faster-whisper": {
        "model_ref": "Systran/faster-whisper-base",
        "revision": "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66",
        "packages": {"ctranslate2", "faster-whisper"},
        "endpoint": "audio.transcriptions",
        "has_model_files": True,
    },
    "qwen-mlx": {
        "model_ref": "mlx-community/Qwen3-0.6B-4bit",
        "revision": "73e3e38d981303bc594367cd910ea6eb48349da8",
        "packages": {"mlx", "mlx-lm"},
        "endpoint": "responses",
        "has_model_files": True,
    },
    "parakeet-mlx": {
        "model_ref": "mlx-community/parakeet-tdt_ctc-110m",
        "revision": "d62547387c356a1ab6bb3d85d98b2103f655282e",
        "packages": {"imageio-ffmpeg", "mlx", "parakeet-mlx"},
        "endpoint": "audio.transcriptions",
        "has_model_files": True,
    },
}


def _require_exact_fields(value: Any, fields: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != fields:
        actual = sorted(value) if isinstance(value, dict) else type(value).__name__
        raise RuntimeError(f"{label} fields are {actual}; expected {sorted(fields)}.")
    return value


def verify_native_backend_smoke(
    target: str,
    receipt: Any,
    *,
    provenance: dict[str, Any],
    source_sha: str,
) -> None:
    expected_target = NATIVE_BACKEND_TARGETS.get(target)
    if expected_target is None:
        if receipt is not None:
            raise RuntimeError(f"{target} contains unexpected native backend evidence.")
        return
    receipt = _require_exact_fields(
        receipt,
        {
            "schema_version",
            "recorded_at",
            "result",
            "platform",
            "source",
            "runtime_provenance",
            "backends",
        },
        "native backend smoke",
    )
    platform = _require_exact_fields(
        receipt["platform"],
        {"system", "release", "machine", "python", "target"},
        "native backend platform",
    )
    source = _require_exact_fields(
        receipt["source"],
        {
            "git_sha",
            "runner_sha256",
            "qwen_adapter_sha256",
            "qwen_mlx_adapter_sha256",
            "faster_whisper_adapter_sha256",
            "parakeet_mlx_adapter_sha256",
        },
        "native backend source",
    )
    if (
        receipt["schema_version"] != 1
        or receipt["result"] != "passed"
        or receipt["runtime_provenance"] != provenance
        or not isinstance(receipt["recorded_at"], str)
        or not receipt["recorded_at"]
        or platform["system"] != expected_target["system"]
        or str(platform["machine"]).lower() not in expected_target["machines"]
        or platform["target"] != target
        or platform["python"] != "3.12.13"
        or source["git_sha"] != source_sha
    ):
        raise RuntimeError(
            f"{target} native backend smoke identity or provenance is invalid."
        )
    for field in (
        "runner_sha256",
        "qwen_adapter_sha256",
        "qwen_mlx_adapter_sha256",
        "faster_whisper_adapter_sha256",
        "parakeet_mlx_adapter_sha256",
    ):
        if not isinstance(source[field], str) or not SHA256.fullmatch(source[field]):
            raise RuntimeError(
                f"{target} native backend source field {field} is invalid."
            )
    backends = receipt["backends"]
    if (
        not isinstance(backends, list)
        or len(backends) != len(expected_target["families"])
        or {backend.get("family") for backend in backends if isinstance(backend, dict)}
        != expected_target["families"]
    ):
        raise RuntimeError(
            f"{target} native backend smoke does not cover its required families."
        )
    for backend in backends:
        family = backend["family"]
        fixture = NATIVE_BACKEND_FIXTURES[family]
        expected_fields = {
            "family",
            "result",
            "model_ref",
            "revision",
            "packages",
            "request_shape",
            "output",
            "timing_ms",
        }
        if fixture["has_model_files"]:
            expected_fields.add("model_files")
        _require_exact_fields(backend, expected_fields, f"{family} native backend")
        if (
            backend["result"] != "passed"
            or backend["model_ref"] != fixture["model_ref"]
            or backend["revision"] != fixture["revision"]
        ):
            raise RuntimeError(
                f"{family} native smoke did not pass with its pinned fixture revision."
            )
        packages = backend["packages"]
        if (
            not isinstance(packages, dict)
            or set(packages) != fixture["packages"]
            or any(
                not isinstance(value, str) or not value for value in packages.values()
            )
        ):
            raise RuntimeError(f"{family} native smoke package evidence is incomplete.")
        request_shape = backend["request_shape"]
        if (
            not isinstance(request_shape, dict)
            or request_shape.get("endpoint") != fixture["endpoint"]
            or request_shape.get("stream") is not False
            or not isinstance(request_shape.get("input_sha256"), str)
            or not SHA256.fullmatch(request_shape["input_sha256"])
        ):
            raise RuntimeError(f"{family} native smoke request evidence is invalid.")
        output = backend["output"]
        minimum_text_chars = 1 if family in {"qwen-transformers", "qwen-mlx"} else 0
        expected_output_key = (
            "output_text" if fixture["endpoint"] == "responses" else "text"
        )
        output_keys = output.get("keys") if isinstance(output, dict) else None
        text_chars = output.get("text_chars") if isinstance(output, dict) else None
        if (
            not isinstance(output, dict)
            or output.get("type") != "dict"
            or not isinstance(output_keys, list)
            or expected_output_key not in output_keys
            or any(not isinstance(key, str) or not key for key in output_keys)
            or not isinstance(text_chars, int)
            or isinstance(text_chars, bool)
            or text_chars < minimum_text_chars
        ):
            raise RuntimeError(f"{family} native smoke output evidence is invalid.")
        timing = backend["timing_ms"]
        if (
            not isinstance(timing, dict)
            or set(timing) != {"load", "request"}
            or any(
                not isinstance(value, (int, float))
                or isinstance(value, bool)
                or not 0 <= value <= 1_800_000
                for value in timing.values()
            )
        ):
            raise RuntimeError(f"{family} native smoke timing evidence is invalid.")
        if fixture["has_model_files"]:
            model_files = backend["model_files"]
            if (
                not isinstance(model_files, list)
                or not model_files
                or any(
                    not isinstance(item, dict)
                    or set(item) != {"path", "bytes", "sha256"}
                    or not isinstance(item["bytes"], int)
                    or item["bytes"] <= 0
                    or not isinstance(item["sha256"], str)
                    or not SHA256.fullmatch(item["sha256"])
                    for item in model_files
                )
            ):
                raise RuntimeError(f"{family} fixture file provenance is incomplete.")
