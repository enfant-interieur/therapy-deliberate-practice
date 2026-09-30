"""Pinned, bounded model asset inventory. Never enumerate unrelated user files."""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
from pathlib import Path
from typing import Any

from local_runtime.cancellation import InferenceCancelledError

CATALOG = json.loads((Path(__file__).parents[1] / "catalog-assets.json").read_text())["models"]

OVERRIDE_ENV = {
    "local//llm/qwen3-mlx": ("LOCAL_RUNTIME_QWEN3_MLX_MODEL", "LOCAL_RUNTIME_QWEN3_MLX_REVISION"),
    "local//llm/qwen3-hf": ("LOCAL_RUNTIME_QWEN3_HF_MODEL", "LOCAL_RUNTIME_QWEN3_HF_REVISION"),
    "local//stt/faster-whisper": (
        "LOCAL_RUNTIME_FASTER_WHISPER_MODEL",
        "LOCAL_RUNTIME_FASTER_WHISPER_REVISION",
    ),
    "local//stt/parakeet-mlx": ("LOCAL_RUNTIME_STT_MODEL", "LOCAL_RUNTIME_STT_REVISION"),
}


def backend_overridden(model_id: str) -> bool:
    names = OVERRIDE_ENV.get(model_id)
    entry = CATALOG.get(model_id)
    if not names or not entry:
        return False
    model, revision = (os.getenv(name) for name in names)
    accepted = {entry["repo"], "base"} if model_id == "local//stt/faster-whisper" else {entry["repo"]}
    return bool((model and model not in accepted) or (revision and revision != entry["revision"]))


class PreparationCancelled(InferenceCancelledError):
    pass


def cache_roots(cache_dir: str) -> list[Path]:
    # The configured directory remains the write destination. Existing Hub assets
    # may be reused read-only, avoiding a duplicate copy after installing the app.
    standard = Path(
        os.getenv(
            "HF_HUB_CACHE", str(Path(os.getenv("HF_HOME", str(Path.home() / ".cache/huggingface"))) / "hub")
        )
    )
    return list(dict.fromkeys([Path(cache_dir).expanduser(), standard]))


def snapshot_state(entry: dict, cache_dir: str) -> dict:
    candidates = []
    for root in cache_roots(cache_dir):
        snapshot = root / ("models--" + entry["repo"].replace("/", "--")) / "snapshots" / entry["revision"]
        present = 0
        complete = 0
        for file in entry["files"]:
            path = snapshot / file["name"]
            try:
                size = path.stat().st_size if path.is_file() else 0
            except OSError:
                size = 0
            if size == file["bytes"]:
                complete += 1
                present += size
        candidates.append(
            {
                "state": "cached"
                if complete == len(entry["files"])
                else "partial"
                if complete
                else "missing",
                "completed_bytes": present,
                "total_bytes": entry["download_bytes"],
                "completed_files": complete,
                "total_files": len(entry["files"]),
                "snapshot": snapshot,
            }
        )
    return next((item for item in candidates if item["state"] == "cached"), candidates[0])


def prepare_assets(model_id: str, cache_dir: str, progress=None, cancel=None) -> str | None:
    if backend_overridden(model_id):
        return None
    entry = CATALOG.get(model_id)
    if entry is None:
        return None
    state = snapshot_state(entry, cache_dir)
    if state["state"] == "cached":
        if progress:
            progress("loading", state["completed_bytes"], state["total_bytes"])
        return str(state["snapshot"])
    from huggingface_hub import hf_hub_download

    destination = Path(cache_dir).expanduser()
    destination.mkdir(parents=True, exist_ok=True)
    # Account for missing runtime files and temporary transfer overhead.
    needed = entry["download_bytes"] - state["completed_bytes"]
    if shutil.disk_usage(destination).free < needed + 1024**3:
        raise OSError("model_storage_insufficient")
    target_root = destination
    for file in entry["files"]:
        if cancel and cancel.is_set():
            raise PreparationCancelled("preparation_cancelled")
        path = state["snapshot"] / file["name"]
        if path.is_file() and path.stat().st_size == file["bytes"]:
            continue
        if progress:
            progress("downloading", state["completed_bytes"], state["total_bytes"])
        hf_hub_download(entry["repo"], file["name"], revision=entry["revision"], cache_dir=str(target_root))
        state = snapshot_state(entry, str(target_root))
    if cancel and cancel.is_set():
        raise PreparationCancelled("preparation_cancelled")
    if state["state"] != "cached":
        raise RuntimeError("model_assets_incomplete")
    if progress:
        progress("loading", state["completed_bytes"], state["total_bytes"])
    return str(state["snapshot"])


def system_resources(cache_dir: str) -> dict[str, Any]:
    memory = None
    try:
        if platform.system() == "Darwin":
            memory = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"], timeout=2))
        elif platform.system() == "Linux":
            memory = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
        elif platform.system() == "Windows":
            import ctypes

            class MemoryStatus(ctypes.Structure):
                _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [
                    (name, ctypes.c_ulonglong)
                    for name in [
                        "total",
                        "available",
                        "page_total",
                        "page_available",
                        "virtual_total",
                        "virtual_available",
                        "extended",
                    ]
                ]

            status = MemoryStatus()
            status.length = ctypes.sizeof(status)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                memory = status.total
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    path = Path(cache_dir).expanduser()
    while not path.exists() and path != path.parent:
        path = path.parent
    return {
        "memory_bytes": memory,
        "cache_free_bytes": shutil.disk_usage(path).free,
        "logging_policy": "metadata_only",
    }


def inventory(registry, cache_dir: str) -> dict:
    resources = system_resources(cache_dir)
    models = []
    for model in registry.list_models():
        spec = model.spec
        entry = CATALOG.get(spec.id)
        if not entry:
            continue
        state = snapshot_state(entry, cache_dir)
        state.pop("snapshot")
        models.append(
            {
                "id": spec.id,
                "title": spec.display.title,
                "kind": spec.kind,
                "endpoint": spec.api.endpoint,
                "compatible": registry.platform_id in spec.compat.platforms,
                "runtime_override": backend_overridden(spec.id),
                "ram_gb": spec.compat.requires_ram_gb,
                "memory_suitable": resources["memory_bytes"] is None
                or resources["memory_bytes"] >= spec.compat.requires_ram_gb * 1024**3,
                "provider": spec.backend.provider,
                "license": entry["license"],
                "revision": entry["revision"],
                "languages": entry["languages"],
                "source": entry["source"],
                "assets": state,
                "loaded": spec.id in registry.model_instances,
                "loading": spec.id in registry._load_tasks,
                "active_requests": sum(mid == spec.id for mid in list(registry.active_models.values())),
            }
        )
    return {
        "platform_id": registry.platform_id,
        "resources": resources,
        "models": models,
        "defaults": registry.selected_defaults,
    }
