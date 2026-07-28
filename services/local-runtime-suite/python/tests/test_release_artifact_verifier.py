from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[2] / "desktop" / "scripts" / "verify-release-artifacts.py"
sys.path.insert(0, str(SCRIPT_PATH.parent))
SPEC = importlib.util.spec_from_file_location("verify_release_artifacts", SCRIPT_PATH)
assert SPEC and SPEC.loader
verify_release_artifacts = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verify_release_artifacts)
WRITER_PATH = SCRIPT_PATH.parent / "write-artifact-manifest.py"
WRITER_SPEC = importlib.util.spec_from_file_location("write_artifact_manifest", WRITER_PATH)
assert WRITER_SPEC and WRITER_SPEC.loader
write_artifact_manifest = importlib.util.module_from_spec(WRITER_SPEC)
WRITER_SPEC.loader.exec_module(write_artifact_manifest)

SOURCE_SHA = "a" * 40
VERSION = "0.1.5"
PACKAGE_NAMES = {
    "aarch64-apple-darwin": ["Local.Runtime_0.1.5_aarch64.dmg"],
    "x86_64-apple-darwin": ["Local.Runtime_0.1.5_x64.dmg"],
    "x86_64-pc-windows-msvc": [
        "Local.Runtime_0.1.5_x64-setup.exe",
        "Local.Runtime_0.1.5_x64.msi",
    ],
    "x86_64-unknown-linux-gnu": [
        "Local.Runtime_0.1.5_amd64.AppImage",
        "Local.Runtime_0.1.5_amd64.deb",
        "Local.Runtime_0.1.5_amd64.rpm",
    ],
}


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def signature_receipt(target: str) -> dict:
    if target.endswith("apple-darwin"):
        checks = {
            "app_codesign": True,
            "app_gatekeeper": True,
            "dmg_stapled": True,
        }
    elif target == "x86_64-pc-windows-msvc":
        checks = {
            "installer_authenticode": True,
            "desktop_authenticode": True,
            "sidecar_authenticode": True,
        }
    else:
        checks = {"not_applicable": True}
    return {
        "schema_version": 1,
        "target": target,
        "status": verify_release_artifacts.EXPECTED_SIGNING[target],
        "checks": checks,
    }


def native_backend_result(family: str) -> dict:
    fixture = verify_release_artifacts.NATIVE_BACKEND_FIXTURES[family]
    is_stt = fixture["endpoint"] == "audio.transcriptions"
    backend = {
        "family": family,
        "result": "passed",
        "model_ref": fixture["model_ref"],
        "revision": fixture["revision"],
        "packages": {name: "1.0.0" for name in fixture["packages"]},
        "request_shape": {
            "endpoint": fixture["endpoint"],
            "stream": False,
            "input_sha256": "8" * 64,
        },
        "output": {
            "type": "dict",
            "keys": ["text"] if is_stt else ["output_text"],
            "text_chars": 0 if is_stt else 1,
        },
        "timing_ms": {"load": 1.0, "request": 1.0},
    }
    if fixture["has_model_files"]:
        backend["model_files"] = [{"path": "model.safetensors", "bytes": 1, "sha256": "9" * 64}]
    return backend


def native_backend_receipt(target: str, provenance: dict) -> dict | None:
    expected = verify_release_artifacts.NATIVE_BACKEND_TARGETS.get(target)
    if expected is None:
        return None
    machine = "arm64" if target == "aarch64-apple-darwin" else "x86_64"
    return {
        "schema_version": 1,
        "recorded_at": "2026-07-25T00:00:00+00:00",
        "result": "passed",
        "platform": {
            "system": expected["system"],
            "release": "test",
            "machine": machine,
            "python": "3.12.13",
            "target": target,
        },
        "source": {
            "git_sha": SOURCE_SHA,
            "runner_sha256": "5" * 64,
            "qwen_adapter_sha256": "6" * 64,
            "qwen_mlx_adapter_sha256": "7" * 64,
            "faster_whisper_adapter_sha256": "a" * 64,
            "parakeet_mlx_adapter_sha256": "b" * 64,
        },
        "runtime_provenance": provenance,
        "backends": [native_backend_result(family) for family in sorted(expected["families"])],
    }


def desktop_shell_receipt(target: str) -> dict:
    platform = (
        "darwin"
        if target.endswith("apple-darwin")
        else ("win32" if target == "x86_64-pc-windows-msvc" else "linux")
    )
    return {
        "schema_version": 1,
        "result": "passed",
        "target": target,
        "platform": platform,
        "executable": verify_release_artifacts.EXPECTED_DESKTOP_EXECUTABLES[target],
        "executable_sha256": "c" * 64,
        "launch_method": ("xvfb" if target == "x86_64-unknown-linux-gnu" else "direct"),
        "minimum_alive_ms": 3_000,
        "alive_ms": 3_010.0,
        "process_started": True,
        "process_stopped": True,
        "exit_code_before_stop": None,
        "limitation": None,
    }


def linux_transform_receipt(pre_sha256: str, packaged_sha256: str) -> dict:
    program_headers = [
        {
            "index": 0,
            "type": 6,
            "type_name": "PT_PHDR",
            "flags": 4,
            "offset": 64,
            "virtual_address": 64,
            "physical_address": 64,
            "file_size": 224,
            "memory_size": 224,
            "alignment": 8,
            "sections": [],
        },
        {
            "index": 1,
            "type": 1,
            "type_name": "PT_LOAD",
            "flags": 5,
            "offset": 0,
            "virtual_address": 0x400000,
            "physical_address": 0x400000,
            "file_size": 4096,
            "memory_size": 4096,
            "alignment": 4096,
            "sections": [".text", ".dynstr", ".dynamic"],
        },
        {
            "index": 2,
            "type": 2,
            "type_name": "PT_DYNAMIC",
            "flags": 6,
            "offset": 2048,
            "virtual_address": 0x400800,
            "physical_address": 0x400800,
            "file_size": 64,
            "memory_size": 64,
            "alignment": 8,
            "sections": [".dynamic"],
        },
        {
            "index": 3,
            "type": 0x6474E551,
            "type_name": "PT_GNU_STACK",
            "flags": 6,
            "offset": 0,
            "virtual_address": 0,
            "physical_address": 0,
            "file_size": 0,
            "memory_size": 0,
            "alignment": 16,
            "sections": [],
        },
    ]
    identity = {
        "class": "ELF64",
        "byte_order": "little",
        "abi": 0,
        "abi_version": 0,
        "machine": 62,
        "file_type": 3,
        "entry_point": 0x401000,
        "flags": 0,
        "build_id": "ab" * 20,
    }
    return {
        "schema_version": 2,
        "target": "x86_64-unknown-linux-gnu",
        "result": "passed",
        "transformation_kind": "linuxdeploy-rpath-v2",
        "pre_bundle": {"sha256": pre_sha256, "runtime_paths": []},
        "packaged": {
            "sha256": packaged_sha256,
            "runtime_paths": [{"tag": "RUNPATH", "value": "$ORIGIN/../lib"}],
        },
        "elf_identity": identity,
        "proof": {
            "elf_header": {
                "class": "ELF64",
                "byte_order": "little",
                "ident_version": 1,
                "abi": 0,
                "abi_version": 0,
                "file_type": 3,
                "machine": 62,
                "version": 1,
                "entry_point": 0x401000,
                "flags": 0,
                "elf_header_size": 64,
                "program_header_entry_size": 56,
                "section_header_entry_size": 64,
                "section_header_count": 6,
            },
            "elf_header_transform": {
                "pre_bundle": {
                    "program_header_offset": 64,
                    "section_header_offset": 4096,
                    "program_header_count": 4,
                    "section_name_index": 5,
                    "shstrtab_index": 5,
                },
                "packaged": {
                    "program_header_offset": 64,
                    "section_header_offset": 4352,
                    "program_header_count": 4,
                    "section_name_index": 5,
                    "shstrtab_index": 5,
                },
            },
            "program_headers": {
                "pre_bundle": program_headers,
                "packaged": [dict(header) for header in program_headers],
                "changed_indices": [0, 2],
            },
            "stable_sections": {
                "pre_bundle_sha256": "d" * 64,
                "packaged_sha256": "d" * 64,
                "count": 4,
            },
            "changed_sections": [
                {
                    "name": ".dynamic",
                    "pre_index": 3,
                    "packaged_index": 3,
                    "pre_sha256": "1" * 64,
                    "packaged_sha256": "2" * 64,
                    "pre_address": 0x400800,
                    "packaged_address": 0x400800,
                    "pre_offset": 2048,
                    "packaged_offset": 2048,
                    "pre_size": 64,
                    "packaged_size": 64,
                    "pre_alignment": 8,
                    "packaged_alignment": 8,
                },
                {
                    "name": ".dynstr",
                    "pre_index": 2,
                    "packaged_index": 2,
                    "pre_sha256": "3" * 64,
                    "packaged_sha256": "4" * 64,
                    "pre_address": 0x400400,
                    "packaged_address": 0x400400,
                    "pre_offset": 1024,
                    "packaged_offset": 1024,
                    "pre_size": 64,
                    "packaged_size": 64,
                    "pre_alignment": 1,
                    "packaged_alignment": 1,
                },
            ],
            "changed_dynamic_tags": ["RUNPATH"],
            "dynamic_string_sizes": {"pre_bundle": 64, "packaged": 64},
            "runtime_path_string": {
                "tag": "RUNPATH",
                "value": "$ORIGIN/../lib",
                "offset": 11,
                "byte_length": 15,
                "mode": "zero-padding-replacement",
                "preserved_sha256": "e" * 64,
            },
        },
    }


def write_valid_target(root: Path, target: str) -> Path:
    target_root = root / target
    packages_dir = target_root / "packages"
    packages_dir.mkdir(parents=True)
    artifacts = []
    for index, name in enumerate(PACKAGE_NAMES[target], start=1):
        payload = f"{target}:{index}".encode()
        package = packages_dir / name
        package.write_bytes(payload)
        artifacts.append(
            {
                "path": f"packages/{name}",
                "bytes": len(payload),
                "sha256": digest(payload),
            }
        )
    provenance = {
        "schema_version": 1,
        "target": target,
        "python_version": "3.12.13",
        "python_asset": f"python-{target}.tar.gz",
        "python_asset_sha256": "1" * 64,
        "asset_manifest_sha256": "2" * 64,
        "runtime_source_sha256": "3" * 64,
        "app_version": VERSION,
        "launcher_target": target,
        "launcher_sha256": "4" * 64,
    }
    platform = (
        "darwin"
        if target.endswith("apple-darwin")
        else ("win32" if target == "x86_64-pc-windows-msvc" else "linux")
    )
    smoke = {
        "schema_version": 1,
        "result": "passed",
        "launcher": "local-runtime-gateway",
        "packaged_launcher_sha256": (
            "9" * 64 if target.endswith("apple-darwin") else provenance["launcher_sha256"]
        ),
        "runtime_provenance": provenance,
        "health": {
            "service": "therapy-local-runtime",
            "protocol_version": "1",
            "status": "ready",
        },
        "model_count": 2,
        "startup_ms": 100.0,
        "process_stopped": True,
        "platform": platform,
    }
    if target == "x86_64-unknown-linux-gnu":
        smoke["packaged_launcher_sha256"] = "9" * 64
    native_backend_smoke = native_backend_receipt(target, provenance)
    signature = signature_receipt(target)
    manifest = {
        "schema_version": verify_release_artifacts.ARTIFACT_MANIFEST_SCHEMA_VERSION,
        "target": target,
        "app_version": VERSION,
        "source_sha": SOURCE_SHA,
        "signing_status": signature["status"],
        "signature_evidence": signature,
        "portable_runtime": provenance,
        "packaged_sidecar_smoke": smoke,
        "desktop_shell_smoke": desktop_shell_receipt(target),
        "native_backend_smoke": native_backend_smoke,
        "launcher_transformation": (
            linux_transform_receipt(
                provenance["launcher_sha256"],
                smoke["packaged_launcher_sha256"],
            )
            if target == "x86_64-unknown-linux-gnu"
            else None
        ),
        "artifact_count": len(artifacts),
        "artifact_bytes": sum(item["bytes"] for item in artifacts),
        "artifacts": artifacts,
    }
    path = target_root / "artifact-manifest.json"
    path.write_text(json.dumps(manifest))
    return path


def test_valid_complete_release_passes(tmp_path) -> None:
    for target in PACKAGE_NAMES:
        write_valid_target(tmp_path, target)

    verify_release_artifacts.verify_release(tmp_path, f"v{VERSION}", SOURCE_SHA)


def test_manifest_writer_cli_requires_native_backend_receipt(tmp_path) -> None:
    result = subprocess.run(
        [
            sys.executable,
            str(WRITER_PATH),
            "--target",
            "aarch64-apple-darwin",
            "--bundle-dir",
            str(tmp_path),
            "--packages-dir",
            str(tmp_path),
            "--provenance",
            str(tmp_path / "provenance.json"),
            "--smoke-receipt",
            str(tmp_path / "smoke.json"),
            "--desktop-shell-receipt",
            str(tmp_path / "shell.json"),
            "--signature-receipt",
            str(tmp_path / "signature.json"),
            "--output",
            str(tmp_path / "manifest.json"),
        ],
        capture_output=True,
        check=False,
        text=True,
    )

    assert result.returncode == 2
    assert "--native-backend-receipt" in result.stderr


def test_unsigned_build_workflow_cannot_skip_required_native_smoke() -> None:
    workflow = (SCRIPT_PATH.parents[4] / ".github" / "workflows" / "desktop-build.yml").read_text("utf-8")

    assert "run_native_backend_smoke" not in workflow
    assert "endsWith(matrix.target, '-apple-darwin')" in workflow
    assert "if: runner.os == 'Windows'" in workflow
    assert workflow.count("--native-backend-receipt") == 1
    assert "resolve_source:" in workflow
    assert "source_sha: ${{ steps.source.outputs.source_sha }}" in workflow
    assert "ref: ${{ needs.resolve_source.outputs.source_sha }}" in workflow
    assert "checked_out_sha" in workflow
    assert "BUILD_SOURCE_SHA=$checked_out_sha" in workflow


@pytest.mark.parametrize(
    ("case", "message"),
    [
        ("wrong_target", "identity or provenance"),
        ("wrong_sha", "identity or provenance"),
        ("wrong_provenance", "identity or provenance"),
        ("missing_family", "required families"),
        ("extra_family", "required families"),
        ("failed_result", "did not pass"),
        ("blank_output", "output evidence"),
        ("boolean_output", "output evidence"),
        ("missing_output_key", "output evidence"),
        ("missing_stt_output_key", "output evidence"),
    ],
)
def test_manifest_writer_rejects_invalid_native_backend_evidence(case, message) -> None:
    target = "x86_64-apple-darwin" if case == "extra_family" else "aarch64-apple-darwin"
    provenance = {"target": target, "runtime_source_sha256": "c" * 64}
    receipt = native_backend_receipt(target, provenance)
    assert receipt is not None
    source_sha = SOURCE_SHA

    if case == "wrong_target":
        receipt["platform"]["target"] = "x86_64-unknown-linux-gnu"
    elif case == "wrong_sha":
        receipt["source"]["git_sha"] = "b" * 40
    elif case == "wrong_provenance":
        receipt["runtime_provenance"] = {}
    elif case == "missing_family":
        receipt["backends"] = receipt["backends"][1:]
    elif case == "extra_family":
        receipt["backends"].append(native_backend_result("qwen-transformers"))
    elif case == "failed_result":
        receipt["backends"][0]["result"] = "failed"
    elif case == "blank_output":
        qwen = next(backend for backend in receipt["backends"] if backend["family"] == "qwen-transformers")
        qwen["output"]["text_chars"] = 0
    elif case == "boolean_output":
        qwen = next(backend for backend in receipt["backends"] if backend["family"] == "qwen-transformers")
        qwen["output"]["text_chars"] = True
    elif case == "missing_output_key":
        qwen = next(backend for backend in receipt["backends"] if backend["family"] == "qwen-transformers")
        qwen["output"]["keys"] = []
    elif case == "missing_stt_output_key":
        faster_whisper = next(
            backend for backend in receipt["backends"] if backend["family"] == "faster-whisper"
        )
        faster_whisper["output"]["keys"] = []
    else:  # pragma: no cover - parametrization is exhaustive
        raise AssertionError(f"Unknown test case: {case}")

    with pytest.raises(RuntimeError, match=message):
        write_artifact_manifest.validate_native_backend_receipt(
            target,
            receipt,
            provenance=provenance,
            source_sha=source_sha,
        )


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda manifest: manifest.update(artifacts=[]), "no publishable packages"),
        (
            lambda manifest: manifest["portable_runtime"].update(target="wrong-target"),
            "provenance is inconsistent",
        ),
        (
            lambda manifest: manifest.update(artifact_count=999),
            "artifact_count",
        ),
        (
            lambda manifest: manifest["packaged_sidecar_smoke"].update(runtime_provenance={}),
            "smoke is inconsistent",
        ),
        (
            lambda manifest: manifest["packaged_sidecar_smoke"].update(packaged_launcher_sha256="tampered"),
            "smoke is inconsistent",
        ),
        (
            lambda manifest: manifest["packaged_sidecar_smoke"].update(startup_ms=90_001),
            "smoke is inconsistent",
        ),
    ],
)
def test_fail_open_manifest_shapes_are_rejected(tmp_path, mutation, message) -> None:
    path = write_valid_target(tmp_path, "aarch64-apple-darwin")
    manifest = json.loads(path.read_text())
    mutation(manifest)

    with pytest.raises(RuntimeError, match=message):
        verify_release_artifacts.verify_manifest(
            path,
            manifest,
            expected_version=VERSION,
            source_sha=SOURCE_SHA,
        )


def test_linux_launcher_hash_change_requires_matching_transform_receipt(tmp_path) -> None:
    path = write_valid_target(tmp_path, "x86_64-unknown-linux-gnu")
    manifest = json.loads(path.read_text())
    manifest["launcher_transformation"]["packaged"]["sha256"] = "8" * 64

    with pytest.raises(RuntimeError, match="does not connect sealed provenance"):
        verify_release_artifacts.verify_manifest(
            path,
            manifest,
            expected_version=VERSION,
            source_sha=SOURCE_SHA,
        )


def test_linux_launcher_transform_receipt_cannot_be_omitted(tmp_path) -> None:
    path = write_valid_target(tmp_path, "x86_64-unknown-linux-gnu")
    manifest = json.loads(path.read_text())
    manifest["launcher_transformation"] = None

    with pytest.raises(RuntimeError, match="launcher transformation"):
        verify_release_artifacts.verify_manifest(
            path,
            manifest,
            expected_version=VERSION,
            source_sha=SOURCE_SHA,
        )


def test_non_linux_target_rejects_launcher_transform_receipt(tmp_path) -> None:
    path = write_valid_target(tmp_path, "aarch64-apple-darwin")
    manifest = json.loads(path.read_text())
    manifest["launcher_transformation"] = linux_transform_receipt("4" * 64, "9" * 64)

    with pytest.raises(RuntimeError, match="unexpected launcher transformation"):
        verify_release_artifacts.verify_manifest(
            path,
            manifest,
            expected_version=VERSION,
            source_sha=SOURCE_SHA,
        )


def test_linux_launcher_transform_rejects_executable_stack(tmp_path) -> None:
    path = write_valid_target(tmp_path, "x86_64-unknown-linux-gnu")
    manifest = json.loads(path.read_text())
    for side in ("pre_bundle", "packaged"):
        manifest["launcher_transformation"]["proof"]["program_headers"][side][3]["flags"] = 7

    with pytest.raises(RuntimeError, match="executable or ambiguous GNU stack"):
        verify_release_artifacts.verify_manifest(
            path,
            manifest,
            expected_version=VERSION,
            source_sha=SOURCE_SHA,
        )


def test_manifest_writer_requires_linux_transform_to_bind_both_launcher_hashes() -> None:
    provenance = {"launcher_sha256": "4" * 64}
    smoke = {"packaged_launcher_sha256": "9" * 64}
    receipt = linux_transform_receipt(provenance["launcher_sha256"], smoke["packaged_launcher_sha256"])

    assert (
        write_artifact_manifest.validate_launcher_transformation(
            "x86_64-unknown-linux-gnu",
            receipt,
            provenance=provenance,
            smoke=smoke,
        )
        == receipt
    )
    receipt["packaged"]["sha256"] = "8" * 64
    with pytest.raises(RuntimeError, match="connect sealed provenance"):
        write_artifact_manifest.validate_launcher_transformation(
            "x86_64-unknown-linux-gnu",
            receipt,
            provenance=provenance,
            smoke=smoke,
        )


@pytest.mark.parametrize(
    "target",
    [
        "aarch64-apple-darwin",
        "x86_64-apple-darwin",
        "x86_64-pc-windows-msvc",
        "x86_64-unknown-linux-gnu",
    ],
)
def test_required_native_backend_receipt_cannot_be_omitted(tmp_path, target) -> None:
    path = write_valid_target(tmp_path, target)
    manifest = json.loads(path.read_text())
    manifest["native_backend_smoke"] = None

    with pytest.raises(RuntimeError, match="native backend smoke"):
        verify_release_artifacts.verify_manifest(
            path,
            manifest,
            expected_version=VERSION,
            source_sha=SOURCE_SHA,
        )


def test_apple_silicon_receipt_requires_every_advertised_backend_family(tmp_path) -> None:
    path = write_valid_target(tmp_path, "aarch64-apple-darwin")
    manifest = json.loads(path.read_text())
    manifest["native_backend_smoke"]["backends"] = [
        backend
        for backend in manifest["native_backend_smoke"]["backends"]
        if backend["family"] != "qwen-transformers"
    ]

    with pytest.raises(RuntimeError, match="required families"):
        verify_release_artifacts.verify_manifest(
            path,
            manifest,
            expected_version=VERSION,
            source_sha=SOURCE_SHA,
        )


def test_intel_macos_receipt_requires_faster_whisper(tmp_path) -> None:
    path = write_valid_target(tmp_path, "x86_64-apple-darwin")
    manifest = json.loads(path.read_text())
    manifest["native_backend_smoke"]["backends"] = []

    with pytest.raises(RuntimeError, match="required families"):
        verify_release_artifacts.verify_manifest(
            path,
            manifest,
            expected_version=VERSION,
            source_sha=SOURCE_SHA,
        )


def test_native_backend_receipt_rejects_an_unadvertised_extra_family(tmp_path) -> None:
    path = write_valid_target(tmp_path, "x86_64-apple-darwin")
    manifest = json.loads(path.read_text())
    manifest["native_backend_smoke"]["backends"].append(native_backend_result("qwen-transformers"))

    with pytest.raises(RuntimeError, match="required families"):
        verify_release_artifacts.verify_manifest(
            path,
            manifest,
            expected_version=VERSION,
            source_sha=SOURCE_SHA,
        )


@pytest.mark.parametrize(
    ("family", "mutation"),
    [
        ("qwen-transformers", "blank"),
        ("qwen-mlx", "blank"),
        ("qwen-transformers", "boolean"),
        ("faster-whisper", "boolean"),
        ("qwen-transformers", "missing_key"),
        ("faster-whisper", "missing_key"),
    ],
)
def test_native_backend_receipt_rejects_invalid_output_evidence(
    tmp_path,
    family,
    mutation,
) -> None:
    path = write_valid_target(tmp_path, "aarch64-apple-darwin")
    manifest = json.loads(path.read_text())
    backend = next(
        entry for entry in manifest["native_backend_smoke"]["backends"] if entry["family"] == family
    )
    if mutation == "blank":
        backend["output"]["text_chars"] = 0
    elif mutation == "boolean":
        backend["output"]["text_chars"] = True
    elif mutation == "missing_key":
        backend["output"]["keys"] = []
    else:  # pragma: no cover - parametrization is exhaustive
        raise AssertionError(f"Unknown mutation: {mutation}")

    with pytest.raises(RuntimeError, match="output evidence"):
        verify_release_artifacts.verify_manifest(
            path,
            manifest,
            expected_version=VERSION,
            source_sha=SOURCE_SHA,
        )


def test_desktop_shell_must_launch_and_stop_without_a_limitation(tmp_path) -> None:
    path = write_valid_target(tmp_path, "aarch64-apple-darwin")
    manifest = json.loads(path.read_text())
    manifest["desktop_shell_smoke"]["limitation"] = "not tested"

    with pytest.raises(RuntimeError, match="desktop-shell smoke"):
        verify_release_artifacts.verify_manifest(
            path,
            manifest,
            expected_version=VERSION,
            source_sha=SOURCE_SHA,
        )


def test_desktop_shell_must_identify_the_first_party_executable(tmp_path) -> None:
    path = write_valid_target(tmp_path, "x86_64-pc-windows-msvc")
    manifest = json.loads(path.read_text())
    manifest["desktop_shell_smoke"]["executable"] = "uninstall.exe"

    with pytest.raises(RuntimeError, match="desktop-shell smoke"):
        verify_release_artifacts.verify_manifest(
            path,
            manifest,
            expected_version=VERSION,
            source_sha=SOURCE_SHA,
        )
