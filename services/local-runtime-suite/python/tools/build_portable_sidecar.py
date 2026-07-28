from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import ssl
import subprocess
import tarfile
import tempfile
import urllib.error
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

SUPPORTED_TARGETS = {
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "x86_64-pc-windows-msvc",
    "x86_64-unknown-linux-gnu",
}
PYTORCH_CPU_INDEX_URL = "https://download.pytorch.org/whl/cpu"
MINIMUM_MACOS_PLATFORM = {
    "aarch64-apple-darwin": "macosx_14_0_arm64",
    "x86_64-apple-darwin": "macosx_14_0_x86_64",
}
SOURCE_ROOTS = ("local_runtime", "tools", "pyinstaller-hooks")
SOURCE_FILES = ("pyproject.toml", "uv.lock", "pyinstaller.local_runtime_gateway.spec")
EMBEDDED_ENVIRONMENT_BLOCKLIST = {
    "PYTHONHOME",
    "PYTHONPATH",
    "PYTHONUSERBASE",
    "PIP_PREFIX",
    "PIP_TARGET",
}


def urlopen_with_cert_fallback(req: urllib.request.Request):
    try:
        return urllib.request.urlopen(req)
    except urllib.error.URLError as error:
        reason = getattr(error, "reason", None)
        if not isinstance(reason, ssl.SSLCertVerificationError):
            raise
        try:
            import certifi  # type: ignore
        except ImportError as exc:
            raise RuntimeError("TLS certificate verification failed and certifi is unavailable.") from exc
        context = ssl.create_default_context(cafile=certifi.where())
        return urllib.request.urlopen(req, context=context)


def run(
    command: list[str],
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
) -> None:
    subprocess.check_call(command, cwd=str(cwd) if cwd else None, env=env)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def host_target_triple() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    if system == "darwin":
        return "aarch64-apple-darwin" if machine in {"arm64", "aarch64"} else "x86_64-apple-darwin"
    if system == "linux":
        return "aarch64-unknown-linux-gnu" if machine in {"arm64", "aarch64"} else "x86_64-unknown-linux-gnu"
    if system == "windows":
        return "aarch64-pc-windows-msvc" if machine in {"arm64", "aarch64"} else "x86_64-pc-windows-msvc"
    raise RuntimeError(f"Unsupported build host: {system} {machine}")


def load_asset_manifest(path: Path) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Could not read Python runtime asset manifest {path}: {error}") from error
    if manifest.get("schema_version") != 1:
        raise RuntimeError("Python runtime asset manifest must use schema_version 1.")
    if not isinstance(manifest.get("python_version"), str):
        raise TypeError("Python runtime asset manifest is missing python_version.")
    targets = manifest.get("targets")
    if not isinstance(targets, dict) or set(targets) != SUPPORTED_TARGETS:
        raise RuntimeError(
            "Python runtime asset manifest targets must exactly match the supported desktop targets."
        )
    return manifest


def resolve_asset(manifest: dict[str, Any], target: str) -> dict[str, str]:
    if target not in SUPPORTED_TARGETS:
        raise RuntimeError(f"Unsupported sidecar target: {target}")
    asset = manifest["targets"].get(target)
    required = {"name", "url", "sha256"}
    if not isinstance(asset, dict) or not required.issubset(asset):
        raise RuntimeError(f"Python runtime asset metadata is incomplete for {target}.")
    sha256 = str(asset["sha256"]).lower()
    if len(sha256) != 64 or any(character not in "0123456789abcdef" for character in sha256):
        raise RuntimeError(f"Python runtime SHA-256 is invalid for {target}.")
    return {key: str(asset[key]) for key in required}


def download(url: str, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    headers = {"User-Agent": "therapy-local-runtime-builder"}
    request = urllib.request.Request(url, headers=headers)
    temporary_path = output_path.with_suffix(f"{output_path.suffix}.partial")
    temporary_path.unlink(missing_ok=True)
    try:
        with urlopen_with_cert_fallback(request) as response, temporary_path.open("wb") as output:
            shutil.copyfileobj(response, output)
        os.replace(temporary_path, output_path)
    finally:
        temporary_path.unlink(missing_ok=True)


def verify_checksum(path: Path, expected_sha256: str) -> None:
    actual_sha256 = sha256_file(path)
    if actual_sha256 != expected_sha256:
        raise RuntimeError(
            f"Checksum mismatch for {path.name}: expected {expected_sha256}, got {actual_sha256}."
        )


def _safe_archive_path(root: Path, member_name: str) -> Path:
    pure_path = PurePosixPath(member_name.replace("\\", "/"))
    if pure_path.is_absolute() or ".." in pure_path.parts:
        raise RuntimeError(f"Unsafe archive member path: {member_name}")
    destination = (root / Path(*pure_path.parts)).resolve()
    if destination != root and root not in destination.parents:
        raise RuntimeError(f"Archive member escapes destination: {member_name}")
    return destination


def _safe_archive_link_target(
    root: Path,
    member_name: str,
    link_name: str,
    *,
    relative_to_member: bool,
) -> Path:
    link_path = PurePosixPath(link_name.replace("\\", "/"))
    if link_path.is_absolute():
        raise RuntimeError(f"Unsafe archive link target: {member_name} -> {link_name}")
    base = PurePosixPath(member_name.replace("\\", "/")).parent if relative_to_member else PurePosixPath()
    normalized: list[str] = []
    for part in (*base.parts, *link_path.parts):
        if part in {"", "."}:
            continue
        if part == "..":
            if not normalized:
                raise RuntimeError(f"Archive link escapes destination: {member_name} -> {link_name}")
            normalized.pop()
            continue
        normalized.append(part)
    destination = (root / Path(*normalized)).resolve()
    if destination != root and root not in destination.parents:
        raise RuntimeError(f"Archive link escapes destination: {member_name} -> {link_name}")
    return destination


def _validate_tar_member(root: Path, member: tarfile.TarInfo) -> None:
    _safe_archive_path(root, member.name)
    if not (member.isreg() or member.isdir() or member.issym() or member.islnk()):
        raise RuntimeError(f"Unsupported special file in archive: {member.name}")
    if member.issym() or member.islnk():
        _safe_archive_link_target(
            root,
            member.name,
            member.linkname,
            relative_to_member=member.issym(),
        )


def _validate_zip_member(root: Path, member: zipfile.ZipInfo) -> None:
    _safe_archive_path(root, member.filename)
    unix_mode = member.external_attr >> 16
    if (unix_mode & 0o170000) == 0o120000:
        raise RuntimeError(f"Symbolic links are not allowed in zip runtime archives: {member.filename}")


def extract(archive: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    root = output_dir.resolve()
    name = archive.name.lower()
    if name.endswith(".tar.gz"):
        with tarfile.open(archive, "r:gz") as bundle:
            for member in bundle.getmembers():
                _validate_tar_member(root, member)
            bundle.extractall(root, filter="data")
        return
    if name.endswith(".zip"):
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.infolist():
                _validate_zip_member(root, member)
            bundle.extractall(root)
        return
    raise RuntimeError(f"Unsupported Python runtime archive: {archive.name}")


def find_python_executable(extracted_root: Path) -> Path:
    candidates = [
        *extracted_root.rglob("python.exe"),
        *extracted_root.rglob("bin/python3"),
        *extracted_root.rglob("bin/python"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise RuntimeError(f"Could not find the embedded Python executable under {extracted_root}.")


def copy_tree(source: Path, destination: Path) -> None:
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(source, destination, symlinks=True)


def runtime_dependency_install_command(
    *,
    embedded_python: Path,
    requirements_path: Path,
    pylibs: Path,
    target: str,
) -> list[str]:
    command = [
        str(embedded_python),
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-compile",
        "--only-binary=:all:",
        "--requirement",
        str(requirements_path),
        "--target",
        str(pylibs),
    ]
    if target in {"x86_64-unknown-linux-gnu", "x86_64-pc-windows-msvc"}:
        command.extend(["--extra-index-url", PYTORCH_CPU_INDEX_URL])
    if target in MINIMUM_MACOS_PLATFORM:
        command.extend(
            [
                "--platform",
                MINIMUM_MACOS_PLATFORM[target],
                "--python-version",
                "3.12",
                "--implementation",
                "cp",
                "--abi",
                "cp312",
            ]
        )
    return command


def generated_bytecode_paths(root: Path) -> list[Path]:
    generated: list[Path] = []
    for current_root, directory_names, filenames in os.walk(root, topdown=True, followlinks=False):
        current = Path(current_root)
        retained_directories = []
        for directory_name in directory_names:
            candidate = current / directory_name
            if directory_name == "__pycache__":
                generated.append(candidate)
            elif candidate.is_symlink():
                continue
            else:
                retained_directories.append(directory_name)
        directory_names[:] = retained_directories
        generated.extend(
            current / filename for filename in filenames if Path(filename).suffix.lower() in {".pyc", ".pyo"}
        )
    return sorted(generated)


def prune_generated_bytecode(root: Path) -> None:
    for path in generated_bytecode_paths(root):
        if path.is_symlink() or path.is_file():
            path.unlink()
        elif path.is_dir():
            shutil.rmtree(path)
    remaining = generated_bytecode_paths(root)
    if remaining:
        relative = ", ".join(str(path.relative_to(root)) for path in remaining[:5])
        raise RuntimeError(f"Generated Python bytecode remains in the portable runtime: {relative}")


def prune_windows_torch_headers(pylibs: Path, target: str) -> None:
    if target != "x86_64-pc-windows-msvc":
        return
    torch_headers = pylibs / "torch" / "include"
    if torch_headers.is_symlink():
        raise RuntimeError(f"Refusing to prune symlinked Torch headers: {torch_headers}")
    if torch_headers.exists():
        if not torch_headers.is_dir():
            raise RuntimeError(f"Torch headers path is not a directory: {torch_headers}")
        shutil.rmtree(torch_headers)
    if torch_headers.exists() or torch_headers.is_symlink():
        raise RuntimeError(f"Torch headers remain in the Windows portable runtime: {torch_headers}")


def embedded_python_environment() -> dict[str, str]:
    environment = {
        key: value for key, value in os.environ.items() if key.upper() not in EMBEDDED_ENVIRONMENT_BLOCKLIST
    }
    environment["PYTHONNOUSERSITE"] = "1"
    return environment


def verify_macos_wheel_floor(pylibs: Path, target: str) -> None:
    if target not in MINIMUM_MACOS_PLATFORM:
        return
    wheel_files = sorted(pylibs.glob("*.dist-info/WHEEL"))
    if not wheel_files:
        raise RuntimeError("The portable runtime does not contain installed wheel metadata.")
    incompatible: list[str] = []
    for wheel_file in wheel_files:
        for line in wheel_file.read_text("utf-8").splitlines():
            if not line.startswith("Tag:") or "macosx_" not in line:
                continue
            match = re.search(r"macosx_(\d+)_", line)
            if match and int(match.group(1)) > 14:
                incompatible.append(f"{wheel_file.parent.name}: {line.removeprefix('Tag:').strip()}")
    if incompatible:
        raise RuntimeError(
            "The macOS payload contains wheels newer than the declared macOS 14 floor: "
            + ", ".join(incompatible)
        )


def runtime_source_digest(project_root: Path) -> str:
    paths: list[Path] = []
    for relative in SOURCE_FILES:
        path = project_root / relative
        if not path.is_file():
            raise RuntimeError(f"Required runtime input is missing: {path}")
        paths.append(path)
    for relative in SOURCE_ROOTS:
        source_root = project_root / relative
        if source_root.exists():
            paths.extend(path for path in source_root.rglob("*.py") if path.is_file())

    digest = hashlib.sha256()
    for path in sorted(paths):
        relative = path.relative_to(project_root).as_posix().encode()
        digest.update(relative)
        digest.update(b"\0")
        digest.update(bytes.fromhex(sha256_file(path)))
    return digest.hexdigest()


def resolve_uv() -> str:
    explicit = os.environ.get("UV")
    if explicit:
        return explicit
    executable = shutil.which("uv")
    if executable:
        return executable
    raise RuntimeError("uv is required to export the committed dependency lock. Install uv and retry.")


def export_locked_requirements(project_root: Path, output_path: Path) -> None:
    run(
        [
            resolve_uv(),
            "export",
            "--quiet",
            "--project",
            str(project_root),
            "--locked",
            "--no-dev",
            "--no-editable",
            "--no-emit-project",
            "--output-file",
            str(output_path),
        ],
        cwd=project_root,
    )


def build_runtime(
    *,
    project_root: Path,
    runtime_root: Path,
    target: str,
    asset_manifest_path: Path,
    force: bool,
) -> None:
    native_target = host_target_triple()
    if target != native_target:
        raise RuntimeError(
            f"Portable runtimes must be built natively. Host is {native_target}, requested {target}."
        )

    manifest = load_asset_manifest(asset_manifest_path)
    asset = resolve_asset(manifest, target)
    source_sha256 = runtime_source_digest(project_root)
    manifest_sha256 = sha256_file(asset_manifest_path)
    stamp = {
        "schema_version": 1,
        "target": target,
        "python_version": manifest["python_version"],
        "python_asset": asset["name"],
        "python_asset_sha256": asset["sha256"],
        "asset_manifest_sha256": manifest_sha256,
        "runtime_source_sha256": source_sha256,
    }
    stamp_path = runtime_root / ".stamp.json"
    if stamp_path.is_file() and not force:
        try:
            if json.loads(stamp_path.read_text("utf-8")) == stamp:
                print("Portable runtime inputs are unchanged; skipping rebuild.")
                return
        except (OSError, json.JSONDecodeError):
            pass

    if runtime_root.exists():
        shutil.rmtree(runtime_root)
    runtime_root.mkdir(parents=True)
    cache_dir = project_root / ".runtime-cache"
    archive_path = cache_dir / asset["name"]
    if archive_path.exists():
        try:
            verify_checksum(archive_path, asset["sha256"])
        except RuntimeError:
            archive_path.unlink()
    if not archive_path.exists():
        print(f"Downloading verified embedded Python asset: {asset['name']}")
        download(asset["url"], archive_path)
    verify_checksum(archive_path, asset["sha256"])

    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary_root = Path(temporary_directory)
        extracted = temporary_root / "extracted"
        extract(archive_path, extracted)
        python_executable = find_python_executable(extracted)
        python_root = (
            python_executable.parent
            if python_executable.name == "python.exe"
            else python_executable.parent.parent
        )
        copy_tree(python_root, runtime_root / "python")

        requirements_path = temporary_root / "requirements-runtime.lock.txt"
        export_locked_requirements(project_root, requirements_path)
        embedded_python = (
            runtime_root / "python" / "python.exe"
            if platform.system().lower() == "windows"
            else runtime_root / "python" / "bin" / "python3"
        )
        if not embedded_python.exists():
            embedded_python = runtime_root / "python" / "bin" / "python"
        if not embedded_python.exists():
            raise RuntimeError(f"Embedded Python executable is missing: {embedded_python}")

        pylibs = runtime_root / "pylibs"
        pylibs.mkdir()
        environment = embedded_python_environment()
        run(
            runtime_dependency_install_command(
                embedded_python=embedded_python,
                requirements_path=requirements_path,
                pylibs=pylibs,
                target=target,
            ),
            env=environment,
        )
        verify_macos_wheel_floor(pylibs, target)
        run(
            [
                str(embedded_python),
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--no-compile",
                "--no-deps",
                "--target",
                str(pylibs),
                str(project_root),
            ],
            env=environment,
        )
        prune_windows_torch_headers(pylibs, target)
        prune_generated_bytecode(runtime_root)

    stamp_path.write_text(json.dumps(stamp, indent=2, sort_keys=True) + "\n", "utf-8")
    (runtime_root / "build-provenance.json").write_text(
        json.dumps(stamp, indent=2, sort_keys=True) + "\n",
        "utf-8",
    )
    print(f"Portable runtime ready: {runtime_root}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--runtime-root", type=Path, required=True)
    parser.add_argument("--asset-manifest", type=Path)
    parser.add_argument("--target")
    parser.add_argument("--force", action="store_true")
    arguments = parser.parse_args()
    project_root = arguments.project_root.resolve()
    asset_manifest = (
        arguments.asset_manifest.resolve()
        if arguments.asset_manifest
        else project_root / "python-runtime-assets.json"
    )
    build_runtime(
        project_root=project_root,
        runtime_root=arguments.runtime_root.resolve(),
        target=arguments.target or os.environ.get("LOCAL_RUNTIME_SIDECAR_TARGET") or host_target_triple(),
        asset_manifest_path=asset_manifest,
        force=arguments.force,
    )


if __name__ == "__main__":
    main()
