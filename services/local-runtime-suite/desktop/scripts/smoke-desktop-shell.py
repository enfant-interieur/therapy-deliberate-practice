from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

EXPECTED_EXECUTABLE_NAMES = {
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


def launch_command(executable: Path) -> tuple[list[str], str]:
    if sys.platform.startswith("linux"):
        xvfb_run = shutil.which("xvfb-run")
        if not xvfb_run:
            raise RuntimeError(
                "Linux desktop-shell smoke requires xvfb-run to provide a real virtual display."
            )
        return [xvfb_run, "-a", str(executable)], "xvfb"
    return [str(executable)], "direct"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--executable", type=Path, required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--minimum-alive-seconds", type=float, default=3.0)
    arguments = parser.parse_args()
    if not 1 <= arguments.minimum_alive_seconds <= 30:
        raise ValueError("--minimum-alive-seconds must be between 1 and 30.")

    executable = arguments.executable.resolve()
    if not executable.is_file():
        raise RuntimeError(f"Installed desktop executable is missing: {executable}")
    expected_name = EXPECTED_EXECUTABLE_NAMES.get(arguments.target)
    if expected_name is None:
        raise RuntimeError(f"Unsupported desktop release target: {arguments.target}.")
    if executable.name != expected_name:
        raise RuntimeError(
            f"Installed desktop executable must be {expected_name} for "
            f"{arguments.target}, not {executable.name}."
        )
    command, launch_method = launch_command(executable)
    executable_sha256 = sha256_file(executable)
    environment = os.environ.copy()
    environment.setdefault("WEBKIT_DISABLE_COMPOSITING_MODE", "1")
    creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    process = subprocess.Popen(
        command,
        cwd=executable.parent,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=os.name != "nt",
        creationflags=creation_flags,
        env=environment,
    )
    started = time.perf_counter()
    exit_code_before_stop = None
    try:
        deadline = time.monotonic() + arguments.minimum_alive_seconds
        while time.monotonic() < deadline:
            exit_code_before_stop = process.poll()
            if exit_code_before_stop is not None:
                output = process.stdout.read() if process.stdout else ""
                raise RuntimeError(
                    f"Installed desktop shell exited with {exit_code_before_stop}: {output[-4000:]}"
                )
            time.sleep(0.1)
        alive_ms = round((time.perf_counter() - started) * 1000, 2)
    finally:
        stop_process_tree(process)

    if process.poll() is None:
        raise RuntimeError("Installed desktop shell did not stop after the smoke test.")
    if sha256_file(executable) != executable_sha256:
        raise RuntimeError(
            "Installed desktop executable changed during its smoke test."
        )

    receipt = {
        "schema_version": 1,
        "result": "passed",
        "target": arguments.target,
        "platform": sys.platform,
        "executable": executable.name,
        "executable_sha256": executable_sha256,
        "launch_method": launch_method,
        "minimum_alive_ms": int(arguments.minimum_alive_seconds * 1000),
        "alive_ms": alive_ms,
        "process_started": True,
        "process_stopped": True,
        "exit_code_before_stop": exit_code_before_stop,
        "limitation": None,
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    print(json.dumps(receipt, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
