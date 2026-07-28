from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
from pathlib import Path

from native_backend_receipt import verify_native_backend_smoke
from verify_linux_launcher_transform import LINUX_TARGET, validate_receipt

PUBLISHABLE_PATTERNS = {
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
SHA256 = re.compile(r"^[a-f0-9]{64}$")
GIT_SHA = re.compile(r"^[a-f0-9]{40}$")
ARTIFACT_MANIFEST_SCHEMA_VERSION = 2
EXPECTED_DESKTOP_EXECUTABLES = {
    "aarch64-apple-darwin": "local-runtime-desktop",
    "x86_64-apple-darwin": "local-runtime-desktop",
    "x86_64-pc-windows-msvc": "local-runtime-desktop.exe",
    "x86_64-unknown-linux-gnu": "local-runtime-desktop",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect_publishable_packages(bundle_dir: Path, target: str) -> list[Path]:
    patterns = PUBLISHABLE_PATTERNS.get(target)
    if patterns is None:
        raise RuntimeError(f"Unsupported release target: {target}.")
    matches: list[Path] = []
    for pattern in patterns:
        matching = [
            path
            for path in bundle_dir.rglob("*")
            if path.is_file() and not path.is_symlink() and pattern.search(path.name)
        ]
        if len(matching) != 1:
            raise RuntimeError(
                f"{target} requires exactly one package matching {pattern.pattern}; "
                f"found {len(matching)}."
            )
        matches.append(matching[0])
    if len({path.name.lower() for path in matches}) != len(matches):
        raise RuntimeError(f"{target} package filenames are not unique.")
    return matches


def validate_launcher_transformation(
    target: str,
    receipt: object,
    *,
    provenance: dict,
    smoke: dict,
) -> dict | None:
    if target != LINUX_TARGET:
        if receipt is not None:
            raise RuntimeError(
                f"{target} contains unexpected launcher transformation evidence."
            )
        return None
    validated = validate_receipt(receipt)
    if validated["pre_bundle"]["sha256"] != provenance.get(
        "launcher_sha256"
    ) or validated["packaged"]["sha256"] != smoke.get("packaged_launcher_sha256"):
        raise RuntimeError(
            "Linux launcher transformation does not connect sealed provenance to packaged smoke."
        )
    return validated


def validate_native_backend_receipt(
    target: str,
    receipt: dict,
    *,
    provenance: dict,
    source_sha: str,
) -> dict:
    verify_native_backend_smoke(
        target,
        receipt,
        provenance=provenance,
        source_sha=source_sha,
    )
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True)
    parser.add_argument("--bundle-dir", type=Path, required=True)
    parser.add_argument("--packages-dir", type=Path, required=True)
    parser.add_argument("--provenance", type=Path, required=True)
    parser.add_argument("--smoke-receipt", type=Path, required=True)
    parser.add_argument("--desktop-shell-receipt", type=Path, required=True)
    parser.add_argument("--native-backend-receipt", type=Path, required=True)
    parser.add_argument("--launcher-transform-receipt", type=Path)
    parser.add_argument("--signature-receipt", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    provenance = json.loads(arguments.provenance.read_text("utf-8"))
    smoke = json.loads(arguments.smoke_receipt.read_text("utf-8"))
    desktop_shell_smoke = json.loads(arguments.desktop_shell_receipt.read_text("utf-8"))
    signature = json.loads(arguments.signature_receipt.read_text("utf-8"))
    native_backend_smoke = json.loads(
        arguments.native_backend_receipt.read_text("utf-8")
    )
    source_sha = os.environ.get("BUILD_SOURCE_SHA") or os.environ.get("GITHUB_SHA")
    if not source_sha or not GIT_SHA.fullmatch(source_sha):
        raise RuntimeError(
            "An exact 40-character BUILD_SOURCE_SHA or GITHUB_SHA is required "
            "to seal release provenance."
        )
    native_backend_smoke = validate_native_backend_receipt(
        arguments.target,
        native_backend_smoke,
        provenance=provenance,
        source_sha=source_sha,
    )
    launcher_transformation = (
        json.loads(arguments.launcher_transform_receipt.read_text("utf-8"))
        if arguments.launcher_transform_receipt
        else None
    )
    if provenance.get("target") != arguments.target:
        raise RuntimeError(
            "Portable runtime provenance target does not match the package target."
        )
    if provenance.get("launcher_target") != arguments.target:
        raise RuntimeError(
            "Launcher provenance target does not match the package target."
        )
    if smoke.get("runtime_provenance") != provenance:
        raise RuntimeError(
            "Packaged-sidecar smoke did not exercise the sealed portable runtime."
        )
    if (
        smoke.get("result") != "passed"
        or not isinstance(smoke.get("packaged_launcher_sha256"), str)
        or not SHA256.fullmatch(smoke["packaged_launcher_sha256"])
        # macOS code signing changes the packaged Mach-O bytes after this
        # pre-package launcher digest is sealed.
        or (
            not arguments.target.endswith("apple-darwin")
            and arguments.target != LINUX_TARGET
            and smoke["packaged_launcher_sha256"] != provenance.get("launcher_sha256")
        )
    ):
        raise RuntimeError(
            "Packaged-sidecar smoke does not identify the launcher sealed in provenance."
        )
    launcher_transformation = validate_launcher_transformation(
        arguments.target,
        launcher_transformation,
        provenance=provenance,
        smoke=smoke,
    )
    if signature.get("target") != arguments.target:
        raise RuntimeError(
            "Signature receipt target does not match the package target."
        )
    if (
        desktop_shell_smoke.get("target") != arguments.target
        or desktop_shell_smoke.get("result") != "passed"
        or desktop_shell_smoke.get("executable")
        != EXPECTED_DESKTOP_EXECUTABLES[arguments.target]
        or desktop_shell_smoke.get("process_started") is not True
        or desktop_shell_smoke.get("process_stopped") is not True
        or desktop_shell_smoke.get("limitation") is not None
    ):
        raise RuntimeError(
            "Desktop-shell smoke did not prove a successful installed application launch."
        )

    packages = collect_publishable_packages(arguments.bundle_dir, arguments.target)
    if arguments.packages_dir.exists():
        shutil.rmtree(arguments.packages_dir)
    arguments.packages_dir.mkdir(parents=True)
    artifacts = []
    for package in packages:
        staged = arguments.packages_dir / package.name
        shutil.copy2(package, staged)
        artifacts.append(
            {
                "path": f"packages/{staged.name}",
                "bytes": staged.stat().st_size,
                "sha256": sha256_file(staged),
            }
        )

    manifest = {
        "schema_version": ARTIFACT_MANIFEST_SCHEMA_VERSION,
        "target": arguments.target,
        "app_version": provenance["app_version"],
        "source_sha": source_sha,
        "signing_status": signature["status"],
        "signature_evidence": signature,
        "portable_runtime": provenance,
        "packaged_sidecar_smoke": smoke,
        "desktop_shell_smoke": desktop_shell_smoke,
        "native_backend_smoke": native_backend_smoke,
        "launcher_transformation": launcher_transformation,
        "artifact_count": len(artifacts),
        "artifact_bytes": sum(artifact["bytes"] for artifact in artifacts),
        "artifacts": artifacts,
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(
        f"Wrote {arguments.output}: {len(artifacts)} publishable packages, "
        f"{manifest['artifact_bytes']} bytes."
    )


if __name__ == "__main__":
    main()
