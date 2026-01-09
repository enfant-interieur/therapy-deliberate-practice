from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile
import ssl
import urllib.error
import urllib.request
import zipfile
from pathlib import Path


def urlopen_with_cert_fallback(req: urllib.request.Request):
    """
    Work around missing system root certs by retrying with certifi when available.
    """

    try:
        return urllib.request.urlopen(req)
    except urllib.error.URLError as e:
        reason = getattr(e, "reason", None)
        if not isinstance(reason, ssl.SSLCertVerificationError):
            raise
        try:
            import certifi  # type: ignore
        except Exception:
            raise RuntimeError(
                "TLS certificate verification failed and 'certifi' is not available in the build environment. "
                "Install certifi into python/.venv-tauri or set PYTHON_STANDALONE_URL to a local file."
            ) from e

        context = ssl.create_default_context(cafile=certifi.where())
        return urllib.request.urlopen(req, context=context)


def run(cmd: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    subprocess.check_call(cmd, cwd=str(cwd) if cwd else None, env=env)


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def host_target_triple() -> str:
    sysname = platform.system().lower()
    machine = platform.machine().lower()

    if sysname == "darwin":
        if machine in ("arm64", "aarch64"):
            return "aarch64-apple-darwin"
        return "x86_64-apple-darwin"

    if sysname == "linux":
        if machine in ("arm64", "aarch64"):
            return "aarch64-unknown-linux-gnu"
        return "x86_64-unknown-linux-gnu"

    if sysname == "windows":
        if machine in ("arm64", "aarch64"):
            return "aarch64-pc-windows-msvc"
        return "x86_64-pc-windows-msvc"

    raise RuntimeError(f"Unsupported platform: {sysname} {machine}")


def github_latest_release_json(repo: str) -> dict:
    url = f"https://api.github.com/repos/{repo}/releases/latest"
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    with urlopen_with_cert_fallback(req) as r:
        return json.loads(r.read().decode("utf-8"))


def pick_python_build_standalone_asset(target: str, py_major_minor: str) -> tuple[str, str]:
    """
    Select an install_only asset from indygreg/python-build-standalone.
    Prefers archives that do not require extra tooling for extraction.
    """

    rel = github_latest_release_json("indygreg/python-build-standalone")
    assets = rel.get("assets", [])
    if not assets:
        raise RuntimeError("No assets found in python-build-standalone latest release.")

    pat = re.compile(
        rf"cpython-{re.escape(py_major_minor)}\.\d+.*-{re.escape(target)}-install_only\.(tar\.gz|zip|tar\.zst)$"
    )

    candidates: list[tuple[str, str]] = []
    for a in assets:
        name = a.get("name", "")
        url = a.get("browser_download_url", "")
        if pat.search(name) and url:
            candidates.append((name, url))

    if not candidates:
        pat2 = re.compile(
            rf"cpython-{re.escape(py_major_minor)}\.\d+.*-{re.escape(target)}.*\.(tar\.gz|zip|tar\.zst)$"
        )
        for a in assets:
            name = a.get("name", "")
            url = a.get("browser_download_url", "")
            if pat2.search(name) and url:
                candidates.append((name, url))

    if not candidates:
        raise RuntimeError(
            f"Could not find a python-build-standalone asset for target={target}, python={py_major_minor}. "
            f"Set PYTHON_STANDALONE_URL to override."
        )

    def score(name: str) -> int:
        if name.endswith(".tar.gz"):
            return 0
        if name.endswith(".zip"):
            return 1
        return 2

    candidates.sort(key=lambda t: (score(t[0]), t[0]))
    return candidates[0]


def download(url: str, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "portable-sidecar-builder"})
    with urlopen_with_cert_fallback(req) as r, out.open("wb") as f:
        shutil.copyfileobj(r, f)


def extract(archive: Path, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    name = archive.name.lower()

    if name.endswith(".tar.gz"):
        with tarfile.open(archive, "r:gz") as tf:
            tf.extractall(out_dir)
        return

    if name.endswith(".zip"):
        with zipfile.ZipFile(archive) as zf:
            zf.extractall(out_dir)
        return

    if name.endswith(".tar.zst"):
        unzstd = shutil.which("unzstd") or shutil.which("zstd")
        tar = shutil.which("tar")
        if not tar:
            raise RuntimeError("System 'tar' not found.")
        if not unzstd:
            raise RuntimeError("Need 'unzstd' (zstd) to extract .tar.zst archives.")
        run([tar, "--use-compress-program", "unzstd", "-xf", str(archive), "-C", str(out_dir)])
        return

    raise RuntimeError(f"Unsupported archive type: {archive}")


def find_python_exe(extracted_root: Path) -> Path:
    for p in extracted_root.rglob("python.exe"):
        return p
    for p in extracted_root.rglob("bin/python3"):
        return p
    for p in extracted_root.rglob("bin/python"):
        return p
    raise RuntimeError(f"Could not find python executable under {extracted_root}")


def copy_tree(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst, symlinks=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project-root", required=True, help="Path to the python/ directory (contains pyproject.toml)")
    ap.add_argument(
        "--runtime-root",
        required=True,
        help="Output runtime directory (e.g. desktop/src-tauri/local-runtime-python)",
    )
    ap.add_argument("--python", default="3.12", help="Python major.minor for embedded runtime (default: 3.12)")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    project_root = Path(args.project_root).resolve()
    runtime_root = Path(args.runtime_root).resolve()
    pyproject = project_root / "pyproject.toml"
    if not pyproject.exists():
        raise RuntimeError(f"pyproject.toml not found at {pyproject}")

    target = os.environ.get("LOCAL_RUNTIME_SIDECAR_TARGET") or host_target_triple()

    stamp_path = runtime_root / ".stamp.json"
    stamp = {
        "target": target,
        "python": args.python,
        "pyproject_sha256": sha256_file(pyproject),
    }

    if stamp_path.exists() and not args.force:
        try:
            old = json.loads(stamp_path.read_text("utf-8"))
            if old == stamp:
                print("Portable runtime unchanged; skipping rebuild.")
                return
        except Exception:
            pass

    if runtime_root.exists():
        shutil.rmtree(runtime_root)
    runtime_root.mkdir(parents=True, exist_ok=True)

    standalone_url = os.environ.get("PYTHON_STANDALONE_URL")
    if standalone_url:
        asset_name = Path(standalone_url).name
        asset_url = standalone_url
    else:
        try:
            asset_name, asset_url = pick_python_build_standalone_asset(target, args.python)
        except urllib.error.URLError as e:
            raise RuntimeError(
                "Failed to query python-build-standalone release metadata. "
                "Set PYTHON_STANDALONE_URL to a direct asset URL (or file path) to bypass the API."
            ) from e

    cache_dir = project_root / ".runtime-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    archive_path = cache_dir / asset_name
    if not archive_path.exists():
        print(f"Downloading embedded Python: {asset_name}")
        try:
            download(asset_url, archive_path)
        except urllib.error.URLError as e:
            raise RuntimeError(
                "Failed to download embedded Python archive. "
                "Set PYTHON_STANDALONE_URL to a local file or ensure TLS certificates are configured."
            ) from e

    with tempfile.TemporaryDirectory() as td:
        extracted = Path(td) / "extracted"
        extract(archive_path, extracted)
        py_exe = find_python_exe(extracted)
        py_root = py_exe.parent.parent if py_exe.name != "python.exe" else py_exe.parent
        runtime_python = runtime_root / "python"
        copy_tree(py_root, runtime_python)

    pylibs = runtime_root / "pylibs"
    pylibs.mkdir(parents=True, exist_ok=True)

    if platform.system().lower() == "windows":
        python_exe = runtime_root / "python" / "python.exe"
    else:
        python_exe = runtime_root / "python" / "bin" / "python3"
        if not python_exe.exists():
            python_exe = runtime_root / "python" / "bin" / "python"

    if not python_exe.exists():
        raise RuntimeError(f"Embedded python executable not found at {python_exe}")

    env = os.environ.copy()
    env["PYTHONNOUSERSITE"] = "1"

    try:
        run([str(python_exe), "-m", "pip", "--version"], env=env)
    except Exception:
        run([str(python_exe), "-m", "ensurepip", "--upgrade"], env=env)

    run([str(python_exe), "-m", "pip", "install", "--upgrade", "pip"], env=env)

    run(
        [
            str(python_exe),
            "-m",
            "pip",
            "install",
            "--upgrade",
            "--target",
            str(pylibs),
            str(project_root),
        ],
        env=env,
    )

    stamp_path.write_text(json.dumps(stamp, indent=2), "utf-8")
    print(f"Portable runtime ready: {runtime_root}")


if __name__ == "__main__":
    main()
