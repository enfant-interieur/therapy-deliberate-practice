from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def request_json(url: str, token: str | None = None) -> dict:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode())


def stop_process_tree(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            check=False,
            capture_output=True,
        )
    else:
        os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        if os.name != "nt":
            os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--launcher", type=Path, required=True)
    parser.add_argument("--runtime-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--startup-timeout-seconds", type=int, default=90)
    arguments = parser.parse_args()
    if not 1 <= arguments.startup_timeout_seconds <= 600:
        raise ValueError("--startup-timeout-seconds must be between 1 and 600.")
    launcher = arguments.launcher.resolve()
    runtime_root = arguments.runtime_root.resolve()
    provenance_path = runtime_root / "build-provenance.json"
    pylibs = runtime_root / "pylibs"
    if not launcher.is_file():
        raise RuntimeError(f"Packaged launcher is missing: {launcher}")
    if not provenance_path.is_file() or not pylibs.is_dir():
        raise RuntimeError(f"Packaged Python runtime is incomplete: {runtime_root}")
    packaged_launcher_sha256 = sha256_file(launcher)

    port = free_port()
    token = secrets.token_hex(32)
    with tempfile.TemporaryDirectory() as temporary_directory:
        config_path = Path(temporary_directory) / "config.json"
        config_path.write_text(
            json.dumps(
                {
                    "port": port,
                    "default_models": {},
                    "prefer_local": True,
                    "access_token": token,
                    "data_dir": str(Path(temporary_directory) / "data"),
                    "cache_dir": str(Path(temporary_directory) / "cache"),
                }
            )
        )
        creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        launcher_environment = os.environ.copy()
        launcher_environment["LOCAL_RUNTIME_PACKAGED_ROOT"] = str(runtime_root)
        process = subprocess.Popen(
            [str(launcher), "--port", str(port), "--config", str(config_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            start_new_session=os.name != "nt",
            creationflags=creation_flags,
            env=launcher_environment,
        )
        started = time.perf_counter()
        startup_ms = None
        health = None
        models = None
        try:
            deadline = time.monotonic() + arguments.startup_timeout_seconds
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    output = process.stdout.read() if process.stdout else ""
                    raise RuntimeError(
                        f"Packaged sidecar exited with {process.returncode}: {output[-4000:]}"
                    )
                try:
                    health = request_json(f"http://127.0.0.1:{port}/health")
                    if (
                        health.get("service") == "therapy-local-runtime"
                        and health.get("protocol_version") == "1"
                        and health.get("status") == "ready"
                    ):
                        startup_ms = round((time.perf_counter() - started) * 1000, 2)
                        break
                except (OSError, urllib.error.URLError, json.JSONDecodeError):
                    pass
                time.sleep(0.25)
            else:
                raise RuntimeError(
                    "Packaged sidecar did not become ready within "
                    f"{arguments.startup_timeout_seconds} seconds."
                )
            models = request_json(f"http://127.0.0.1:{port}/v1/models", token)
            if not isinstance(models.get("data"), list):
                raise TypeError(
                    "Authenticated packaged /v1/models response is invalid."
                )
        finally:
            stop_process_tree(process)
    if sha256_file(launcher) != packaged_launcher_sha256:
        raise RuntimeError(
            "The packaged launcher changed while its smoke test was running."
        )

    receipt = {
        "schema_version": 1,
        "result": "passed",
        "launcher": launcher.name,
        "packaged_launcher_sha256": packaged_launcher_sha256,
        "runtime_provenance": json.loads(provenance_path.read_text("utf-8")),
        "health": health,
        "model_count": len(models["data"]),
        "startup_ms": startup_ms,
        "process_stopped": process.poll() is not None,
        "platform": sys.platform,
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    print(json.dumps(receipt, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
