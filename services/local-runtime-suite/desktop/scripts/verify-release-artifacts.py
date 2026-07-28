from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
from typing import Any

import native_backend_receipt
from verify_linux_launcher_transform import LINUX_TARGET, validate_receipt

NATIVE_BACKEND_FIXTURES = native_backend_receipt.NATIVE_BACKEND_FIXTURES
NATIVE_BACKEND_TARGETS = native_backend_receipt.NATIVE_BACKEND_TARGETS

EXPECTED_SIGNING = {
    "aarch64-apple-darwin": "signed-notarized",
    "x86_64-apple-darwin": "signed-notarized",
    "x86_64-pc-windows-msvc": "signed",
    "x86_64-unknown-linux-gnu": "unsigned",
}
EXPECTED_PLATFORM = {
    "aarch64-apple-darwin": "darwin",
    "x86_64-apple-darwin": "darwin",
    "x86_64-pc-windows-msvc": "win32",
    "x86_64-unknown-linux-gnu": "linux",
}
EXPECTED_DESKTOP_EXECUTABLES = {
    "aarch64-apple-darwin": "local-runtime-desktop",
    "x86_64-apple-darwin": "local-runtime-desktop",
    "x86_64-pc-windows-msvc": "local-runtime-desktop.exe",
    "x86_64-unknown-linux-gnu": "local-runtime-desktop",
}
REQUIRED_PACKAGES = {
    "aarch64-apple-darwin": (re.compile(r"(?:aarch64|arm64).*\.dmg$", re.IGNORECASE),),
    "x86_64-apple-darwin": (
        re.compile(r"(?:x64|x86_64|intel).*\.dmg$", re.IGNORECASE),
    ),
    "x86_64-pc-windows-msvc": (
        re.compile(r"(?:x64|x86_64|amd64).*-setup\.exe$", re.IGNORECASE),
        re.compile(r"(?:x64|x86_64|amd64).*\.msi$", re.IGNORECASE),
    ),
    "x86_64-unknown-linux-gnu": (
        re.compile(r"(?:x64|x86_64|amd64).*\.appimage$", re.IGNORECASE),
        re.compile(r"(?:x64|x86_64|amd64).*\.deb$", re.IGNORECASE),
        re.compile(r"(?:x64|x86_64|amd64).*\.rpm$", re.IGNORECASE),
    ),
}
MANIFEST_FIELDS = {
    "schema_version",
    "target",
    "app_version",
    "source_sha",
    "signing_status",
    "signature_evidence",
    "portable_runtime",
    "packaged_sidecar_smoke",
    "desktop_shell_smoke",
    "native_backend_smoke",
    "launcher_transformation",
    "artifact_count",
    "artifact_bytes",
    "artifacts",
}
PROVENANCE_FIELDS = {
    "schema_version",
    "target",
    "python_version",
    "python_asset",
    "python_asset_sha256",
    "asset_manifest_sha256",
    "runtime_source_sha256",
    "app_version",
    "launcher_target",
    "launcher_sha256",
}
SMOKE_FIELDS = {
    "schema_version",
    "result",
    "launcher",
    "packaged_launcher_sha256",
    "runtime_provenance",
    "health",
    "model_count",
    "startup_ms",
    "process_stopped",
    "platform",
}
DESKTOP_SHELL_SMOKE_FIELDS = {
    "schema_version",
    "result",
    "target",
    "platform",
    "executable",
    "executable_sha256",
    "launch_method",
    "minimum_alive_ms",
    "alive_ms",
    "process_started",
    "process_stopped",
    "exit_code_before_stop",
    "limitation",
}
ARTIFACT_FIELDS = {"path", "bytes", "sha256"}
SHA256 = re.compile(r"^[a-f0-9]{64}$")
ARTIFACT_MANIFEST_SCHEMA_VERSION = 2


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_exact_fields(value: Any, fields: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != fields:
        actual = sorted(value) if isinstance(value, dict) else type(value).__name__
        raise RuntimeError(f"{label} fields are {actual}; expected {sorted(fields)}.")
    return value


def resolve_artifact(manifest_dir: Path, relative_path: str) -> Path:
    pure = PurePosixPath(relative_path)
    if pure.is_absolute() or ".." in pure.parts or pure.parts[:1] != ("packages",):
        raise RuntimeError(f"Unsafe or unexpected artifact path: {relative_path}.")
    resolved = (manifest_dir / Path(*pure.parts)).resolve()
    if manifest_dir.resolve() not in resolved.parents:
        raise RuntimeError(
            f"Artifact path escapes its evidence directory: {relative_path}."
        )
    if not resolved.is_file() or resolved.is_symlink():
        raise RuntimeError(
            f"Manifested package is missing or is a symbolic link: {resolved}."
        )
    return resolved


def verify_signature_evidence(target: str, evidence: Any) -> None:
    evidence = require_exact_fields(
        evidence, {"schema_version", "target", "status", "checks"}, "signature evidence"
    )
    if evidence["schema_version"] != 1 or evidence["target"] != target:
        raise RuntimeError(f"{target} signature evidence identity is invalid.")
    if evidence["status"] != EXPECTED_SIGNING[target]:
        raise RuntimeError(f"{target} signature evidence status is invalid.")
    expected_checks = (
        {"app_codesign", "app_gatekeeper", "dmg_stapled"}
        if target.endswith("apple-darwin")
        else (
            {"installer_authenticode", "desktop_authenticode", "sidecar_authenticode"}
            if target == "x86_64-pc-windows-msvc"
            else {"not_applicable"}
        )
    )
    checks = require_exact_fields(
        evidence["checks"], expected_checks, "signature checks"
    )
    if not all(value is True for value in checks.values()):
        raise RuntimeError(f"{target} signature checks did not all pass.")


def verify_launcher_transformation(
    target: str,
    evidence: Any,
    *,
    provenance: dict[str, Any],
    smoke: dict[str, Any],
) -> None:
    if target != LINUX_TARGET:
        if evidence is not None:
            raise RuntimeError(
                f"{target} contains unexpected launcher transformation evidence."
            )
        return
    evidence = validate_receipt(evidence)
    if (
        evidence["pre_bundle"]["sha256"] != provenance["launcher_sha256"]
        or evidence["packaged"]["sha256"] != smoke["packaged_launcher_sha256"]
    ):
        raise RuntimeError(
            "Linux launcher transformation does not connect sealed provenance to packaged smoke."
        )


def verify_desktop_shell_smoke(target: str, receipt: Any) -> None:
    receipt = require_exact_fields(
        receipt,
        DESKTOP_SHELL_SMOKE_FIELDS,
        "desktop-shell smoke",
    )
    expected_launch_method = (
        "xvfb" if target == "x86_64-unknown-linux-gnu" else "direct"
    )
    if (
        receipt["schema_version"] != 1
        or receipt["result"] != "passed"
        or receipt["target"] != target
        or receipt["platform"] != EXPECTED_PLATFORM[target]
        or receipt["executable"] != EXPECTED_DESKTOP_EXECUTABLES[target]
        or not isinstance(receipt["executable_sha256"], str)
        or not SHA256.fullmatch(receipt["executable_sha256"])
        or receipt["launch_method"] != expected_launch_method
        or not isinstance(receipt["minimum_alive_ms"], int)
        or not 1_000 <= receipt["minimum_alive_ms"] <= 30_000
        or not isinstance(receipt["alive_ms"], (int, float))
        or isinstance(receipt["alive_ms"], bool)
        or not receipt["minimum_alive_ms"] <= receipt["alive_ms"] <= 35_000
        or receipt["process_started"] is not True
        or receipt["process_stopped"] is not True
        or receipt["exit_code_before_stop"] is not None
        or receipt["limitation"] is not None
    ):
        raise RuntimeError(
            f"{target} desktop-shell smoke is inconsistent or incomplete."
        )


def verify_manifest(
    manifest_path: Path,
    manifest: Any,
    *,
    expected_version: str,
    source_sha: str,
) -> str:
    manifest = require_exact_fields(manifest, MANIFEST_FIELDS, "artifact manifest")
    if manifest["schema_version"] != ARTIFACT_MANIFEST_SCHEMA_VERSION:
        raise RuntimeError(
            f"Artifact manifest must use schema_version {ARTIFACT_MANIFEST_SCHEMA_VERSION}."
        )
    target = manifest["target"]
    if target not in EXPECTED_SIGNING:
        raise RuntimeError(f"Unknown release target: {target}.")
    if manifest["app_version"] != expected_version:
        raise RuntimeError(f"{target} app version does not match v{expected_version}.")
    if manifest["source_sha"] != source_sha:
        raise RuntimeError(f"{target} source commit does not match the release tag.")
    if manifest["signing_status"] != EXPECTED_SIGNING[target]:
        raise RuntimeError(
            f"{target} signing status is {manifest['signing_status']}; "
            f"publishing requires {EXPECTED_SIGNING[target]}."
        )
    verify_signature_evidence(target, manifest["signature_evidence"])

    provenance = require_exact_fields(
        manifest["portable_runtime"], PROVENANCE_FIELDS, "portable runtime provenance"
    )
    if (
        provenance["schema_version"] != 1
        or provenance["target"] != target
        or provenance["launcher_target"] != target
        or provenance["app_version"] != expected_version
        or provenance["python_version"] != "3.12.13"
    ):
        raise RuntimeError(f"{target} portable runtime provenance is inconsistent.")
    for field in (
        "python_asset_sha256",
        "asset_manifest_sha256",
        "runtime_source_sha256",
        "launcher_sha256",
    ):
        if not isinstance(provenance[field], str) or not SHA256.fullmatch(
            provenance[field]
        ):
            raise RuntimeError(
                f"{target} provenance field {field} is not a SHA-256 digest."
            )

    smoke = require_exact_fields(
        manifest["packaged_sidecar_smoke"], SMOKE_FIELDS, "packaged-sidecar smoke"
    )
    health = smoke["health"]
    if (
        smoke["schema_version"] != 1
        or smoke["result"] != "passed"
        or smoke["process_stopped"] is not True
        or smoke["platform"] != EXPECTED_PLATFORM[target]
        or smoke["runtime_provenance"] != provenance
        or not isinstance(smoke["launcher"], str)
        or not smoke["launcher"]
        or not isinstance(smoke["packaged_launcher_sha256"], str)
        or not SHA256.fullmatch(smoke["packaged_launcher_sha256"])
        # macOS signing changes the packaged Mach-O bytes after the launcher
        # input hash is sealed. Its final bytes are instead covered by the
        # smoke's stable hash and required signature/notarization evidence.
        or (
            not target.endswith("apple-darwin")
            and target != LINUX_TARGET
            and smoke["packaged_launcher_sha256"] != provenance["launcher_sha256"]
        )
        or not isinstance(smoke["startup_ms"], (int, float))
        or isinstance(smoke["startup_ms"], bool)
        or not 0 < smoke["startup_ms"] <= 90_000
        or not isinstance(smoke["model_count"], int)
        or smoke["model_count"] < 1
        or not isinstance(health, dict)
        or health.get("service") != "therapy-local-runtime"
        or health.get("protocol_version") != "1"
        or health.get("status") != "ready"
    ):
        raise RuntimeError(
            f"{target} packaged-sidecar smoke is inconsistent or incomplete."
        )
    verify_launcher_transformation(
        target,
        manifest["launcher_transformation"],
        provenance=provenance,
        smoke=smoke,
    )
    native_backend_receipt.verify_native_backend_smoke(
        target,
        manifest["native_backend_smoke"],
        provenance=provenance,
        source_sha=source_sha,
    )
    verify_desktop_shell_smoke(target, manifest["desktop_shell_smoke"])

    artifacts = manifest["artifacts"]
    if not isinstance(artifacts, list) or not artifacts:
        raise RuntimeError(
            f"{target} artifact manifest contains no publishable packages."
        )
    if manifest["artifact_count"] != len(artifacts):
        raise RuntimeError(f"{target} artifact_count does not match the package list.")
    paths: set[str] = set()
    total_bytes = 0
    resolved_paths: set[Path] = set()
    for artifact in artifacts:
        artifact = require_exact_fields(artifact, ARTIFACT_FIELDS, "artifact")
        if not isinstance(artifact["path"], str) or artifact["path"] in paths:
            raise RuntimeError(f"{target} artifact paths must be unique strings.")
        if not isinstance(artifact["bytes"], int) or artifact["bytes"] <= 0:
            raise RuntimeError(
                f"{target} artifact byte counts must be positive integers."
            )
        if not isinstance(artifact["sha256"], str) or not SHA256.fullmatch(
            artifact["sha256"]
        ):
            raise RuntimeError(f"{target} artifact checksum is invalid.")
        path = resolve_artifact(manifest_path.parent, artifact["path"])
        if path.stat().st_size != artifact["bytes"]:
            raise RuntimeError(f"Size mismatch for {path}.")
        if sha256_file(path) != artifact["sha256"]:
            raise RuntimeError(f"Checksum mismatch for {path}.")
        paths.add(artifact["path"])
        resolved_paths.add(path)
        total_bytes += artifact["bytes"]
    if manifest["artifact_bytes"] != total_bytes:
        raise RuntimeError(f"{target} artifact_bytes does not match the package list.")

    package_names = [path.name for path in resolved_paths]
    for pattern in REQUIRED_PACKAGES[target]:
        if sum(bool(pattern.search(name)) for name in package_names) != 1:
            raise RuntimeError(
                f"{target} requires exactly one package matching {pattern.pattern}."
            )
    if len(package_names) != len(REQUIRED_PACKAGES[target]):
        raise RuntimeError(f"{target} contains unexpected publishable package formats.")
    actual_package_files = {
        path.resolve()
        for path in (manifest_path.parent / "packages").iterdir()
        if path.is_file() and not path.is_symlink()
    }
    if actual_package_files != resolved_paths:
        raise RuntimeError(f"{target} package directory contains unmanifested files.")
    return target


def verify_release(artifacts_root: Path, tag: str, source_sha: str) -> None:
    manifests: dict[str, Path] = {}
    expected_version = tag.removeprefix("v")
    for path in artifacts_root.rglob("artifact-manifest.json"):
        manifest = json.loads(path.read_text("utf-8"))
        target = verify_manifest(
            path,
            manifest,
            expected_version=expected_version,
            source_sha=source_sha,
        )
        if target in manifests:
            raise RuntimeError(f"Duplicate artifact manifest for {target}.")
        manifests[target] = path
    if set(manifests) != set(EXPECTED_SIGNING):
        raise RuntimeError(
            f"Release artifacts cover {sorted(manifests)}, expected {sorted(EXPECTED_SIGNING)}."
        )
    print(f"Verified four signed/native release manifests for {tag} at {source_sha}.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--source-sha", required=True)
    arguments = parser.parse_args()
    verify_release(arguments.artifacts, arguments.tag, arguments.source_sha)


if __name__ == "__main__":
    main()
