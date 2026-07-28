from __future__ import annotations

import io
import json
import tarfile
import zipfile

import pytest

from tools import build_portable_sidecar


def asset_manifest() -> dict:
    targets = {}
    for target in build_portable_sidecar.SUPPORTED_TARGETS:
        targets[target] = {
            "name": f"python-{target}.tar.gz",
            "url": f"https://example.invalid/{target}.tar.gz",
            "sha256": "a" * 64,
        }
    return {
        "schema_version": 1,
        "python_version": "3.12.13",
        "targets": targets,
    }


def test_asset_selection_is_exact_and_rejects_unknown_target(tmp_path) -> None:
    manifest_path = tmp_path / "assets.json"
    manifest_path.write_text(json.dumps(asset_manifest()))
    manifest = build_portable_sidecar.load_asset_manifest(manifest_path)

    selected = build_portable_sidecar.resolve_asset(manifest, "aarch64-apple-darwin")

    assert selected["name"] == "python-aarch64-apple-darwin.tar.gz"
    assert selected["sha256"] == "a" * 64
    with pytest.raises(RuntimeError, match="Unsupported sidecar target"):
        build_portable_sidecar.resolve_asset(manifest, "aarch64-pc-windows-msvc")


def test_checksum_mismatch_fails_closed(tmp_path) -> None:
    archive = tmp_path / "python.tar.gz"
    archive.write_bytes(b"unexpected archive")

    with pytest.raises(RuntimeError, match="Checksum mismatch"):
        build_portable_sidecar.verify_checksum(archive, "0" * 64)


def test_tar_extraction_rejects_parent_traversal(tmp_path) -> None:
    archive = tmp_path / "unsafe.tar.gz"
    with tarfile.open(archive, "w:gz") as bundle:
        member = tarfile.TarInfo("../outside.txt")
        payload = b"escape"
        member.size = len(payload)
        bundle.addfile(member, io.BytesIO(payload))

    with pytest.raises(RuntimeError, match="Unsafe archive member"):
        build_portable_sidecar.extract(archive, tmp_path / "output")
    assert not (tmp_path / "outside.txt").exists()


def test_tar_extraction_allows_relative_link_that_stays_inside_root(tmp_path) -> None:
    archive = tmp_path / "safe-link.tar.gz"
    with tarfile.open(archive, "w:gz") as bundle:
        target = tarfile.TarInfo("python/share/terminfo/a/adm1178")
        payload = b"terminal definition"
        target.size = len(payload)
        bundle.addfile(target, io.BytesIO(payload))
        link = tarfile.TarInfo("python/share/terminfo/1/adm1178")
        link.type = tarfile.SYMTYPE
        link.linkname = "../a/adm1178"
        bundle.addfile(link)

    output = tmp_path / "output"
    build_portable_sidecar.extract(archive, output)

    extracted_link = output / "python/share/terminfo/1/adm1178"
    assert extracted_link.is_symlink()
    assert extracted_link.read_bytes() == payload


def test_tar_extraction_rejects_link_that_escapes_root(tmp_path) -> None:
    archive = tmp_path / "unsafe-link.tar.gz"
    with tarfile.open(archive, "w:gz") as bundle:
        link = tarfile.TarInfo("python/link")
        link.type = tarfile.SYMTYPE
        link.linkname = "../../outside.txt"
        bundle.addfile(link)

    with pytest.raises(RuntimeError, match="Archive link escapes destination"):
        build_portable_sidecar.extract(archive, tmp_path / "output")
    assert not (tmp_path / "outside.txt").exists()


def test_zip_extraction_rejects_parent_traversal(tmp_path) -> None:
    archive = tmp_path / "unsafe.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("../outside.txt", "escape")

    with pytest.raises(RuntimeError, match="Unsafe archive member"):
        build_portable_sidecar.extract(archive, tmp_path / "output")
    assert not (tmp_path / "outside.txt").exists()


def test_runtime_digest_changes_for_source_and_lock_edits(tmp_path) -> None:
    for relative in build_portable_sidecar.SOURCE_FILES:
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"{relative}\n")
    source = tmp_path / "local_runtime" / "main.py"
    source.parent.mkdir()
    source.write_text("VERSION = 1\n")
    before = build_portable_sidecar.runtime_source_digest(tmp_path)

    source.write_text("VERSION = 2\n")
    after_source_change = build_portable_sidecar.runtime_source_digest(tmp_path)
    (tmp_path / "uv.lock").write_text("updated lock\n")
    after_lock_change = build_portable_sidecar.runtime_source_digest(tmp_path)

    assert before != after_source_change
    assert after_source_change != after_lock_change


def test_runtime_digest_ignores_generated_python_cache_files(tmp_path) -> None:
    for relative in build_portable_sidecar.SOURCE_FILES:
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"{relative}\n")
    source = tmp_path / "local_runtime" / "main.py"
    source.parent.mkdir()
    source.write_text("VERSION = 1\n")
    before = build_portable_sidecar.runtime_source_digest(tmp_path)

    cache_file = source.parent / "__pycache__" / "main.cpython-312.pyc"
    cache_file.parent.mkdir()
    cache_file.write_bytes(b"generated bytecode")
    (source.parent / ".DS_Store").write_bytes(b"local metadata")

    assert build_portable_sidecar.runtime_source_digest(tmp_path) == before


def test_cpu_torch_index_is_scoped_to_windows_and_linux_packages(tmp_path) -> None:
    base_arguments = {
        "embedded_python": tmp_path / "python",
        "requirements_path": tmp_path / "requirements.txt",
        "pylibs": tmp_path / "pylibs",
    }

    linux = build_portable_sidecar.runtime_dependency_install_command(
        **base_arguments,
        target="x86_64-unknown-linux-gnu",
    )
    windows = build_portable_sidecar.runtime_dependency_install_command(
        **base_arguments,
        target="x86_64-pc-windows-msvc",
    )
    macos = build_portable_sidecar.runtime_dependency_install_command(
        **base_arguments,
        target="aarch64-apple-darwin",
    )

    assert build_portable_sidecar.PYTORCH_CPU_INDEX_URL in linux
    assert build_portable_sidecar.PYTORCH_CPU_INDEX_URL in windows
    assert build_portable_sidecar.PYTORCH_CPU_INDEX_URL not in macos
    assert "--only-binary=:all:" in linux
    assert "--no-compile" in linux
    assert "--no-compile" in windows
    assert "--no-compile" in macos
    assert (
        macos[macos.index("--platform") + 1]
        == build_portable_sidecar.MINIMUM_MACOS_PLATFORM["aarch64-apple-darwin"]
    )


def test_bytecode_cleanup_removes_deep_windows_path_without_following_symlinks(tmp_path) -> None:
    runtime_root = tmp_path / "local-runtime-python"
    exact_onnx_cache = (
        runtime_root
        / "pylibs"
        / "onnxruntime"
        / "tools"
        / "ort_format_model"
        / "ort_flatbuffers_py"
        / "fbs"
        / "__pycache__"
        / "DeprecatedNodeIndexAndKernelDefHash.cpython-312.pyc"
    )
    exact_onnx_cache.parent.mkdir(parents=True)
    exact_onnx_cache.write_bytes(b"generated bytecode")
    optimized = runtime_root / "pylibs" / "adapter.pyo"
    optimized.write_bytes(b"optimized bytecode")
    source = runtime_root / "pylibs" / "adapter.py"
    source.write_text("VALUE = 1\n")

    external = tmp_path / "external-cache"
    external.mkdir()
    external_bytecode = external / "outside.cpython-312.pyc"
    external_bytecode.write_bytes(b"must remain")
    (runtime_root / "pylibs" / "linked-cache").symlink_to(external, target_is_directory=True)

    build_portable_sidecar.prune_generated_bytecode(runtime_root)

    assert not exact_onnx_cache.exists()
    assert not optimized.exists()
    assert source.read_text() == "VALUE = 1\n"
    assert external_bytecode.read_bytes() == b"must remain"
    assert build_portable_sidecar.generated_bytecode_paths(runtime_root) == []


def test_bytecode_cleanup_fails_closed_when_generated_files_remain(monkeypatch, tmp_path) -> None:
    runtime_root = tmp_path / "runtime"
    stubborn_cache = runtime_root / "__pycache__" / "module.cpython-312.pyc"
    monkeypatch.setattr(
        build_portable_sidecar,
        "generated_bytecode_paths",
        lambda _root: [stubborn_cache],
    )

    with pytest.raises(RuntimeError, match="Generated Python bytecode remains"):
        build_portable_sidecar.prune_generated_bytecode(runtime_root)


def test_windows_torch_header_cleanup_removes_nsis_long_path_and_keeps_runtime_files(
    tmp_path,
) -> None:
    pylibs = tmp_path / "pylibs"
    long_header = (
        pylibs
        / "torch"
        / "include"
        / "ATen"
        / "native"
        / "transformers"
        / "cuda"
        / "mem_eff_attention"
        / "iterators"
        / "predicated_tile_access_iterator_residual_last.h"
    )
    long_header.parent.mkdir(parents=True)
    long_header.write_text("development header\n")
    runtime_module = pylibs / "torch" / "__init__.py"
    runtime_module.write_text("runtime module\n")
    runtime_library = pylibs / "torch" / "lib" / "torch_cpu.dll"
    runtime_library.parent.mkdir()
    runtime_library.write_bytes(b"runtime library")

    build_portable_sidecar.prune_windows_torch_headers(pylibs, "x86_64-pc-windows-msvc")

    assert not (pylibs / "torch" / "include").exists()
    assert runtime_module.read_text() == "runtime module\n"
    assert runtime_library.read_bytes() == b"runtime library"


def test_windows_torch_header_cleanup_fails_closed_for_external_symlink(tmp_path) -> None:
    pylibs = tmp_path / "pylibs"
    external_headers = tmp_path / "external-headers"
    external_headers.mkdir()
    external_header = external_headers / "keep.h"
    external_header.write_text("must remain\n")
    torch_root = pylibs / "torch"
    torch_root.mkdir(parents=True)
    (torch_root / "include").symlink_to(external_headers, target_is_directory=True)

    with pytest.raises(RuntimeError, match="Refusing to prune symlinked Torch headers"):
        build_portable_sidecar.prune_windows_torch_headers(pylibs, "x86_64-pc-windows-msvc")

    assert external_header.read_text() == "must remain\n"


def test_torch_header_cleanup_is_windows_only(tmp_path) -> None:
    pylibs = tmp_path / "pylibs"
    linux_header = pylibs / "torch" / "include" / "torch" / "extension.h"
    linux_header.parent.mkdir(parents=True)
    linux_header.write_text("retain on non-Windows targets\n")

    build_portable_sidecar.prune_windows_torch_headers(pylibs, "x86_64-unknown-linux-gnu")

    assert linux_header.read_text() == "retain on non-Windows targets\n"


def test_macos_wheel_floor_rejects_newer_platform_tag(tmp_path) -> None:
    wheel = tmp_path / "mlx-0.32.0.dist-info" / "WHEEL"
    wheel.parent.mkdir()
    wheel.write_text("Wheel-Version: 1.0\nRoot-Is-Purelib: false\nTag: cp312-cp312-macosx_26_0_arm64\n")

    with pytest.raises(RuntimeError, match="newer than the declared macOS 14 floor"):
        build_portable_sidecar.verify_macos_wheel_floor(tmp_path, "aarch64-apple-darwin")


def test_macos_wheel_floor_accepts_declared_and_older_tags(tmp_path) -> None:
    for name, tag in (
        ("mlx-0.32.0", "cp312-cp312-macosx_14_0_arm64"),
        ("onnxruntime-1.23.2", "cp312-cp312-macosx_13_0_arm64"),
    ):
        wheel = tmp_path / f"{name}.dist-info" / "WHEEL"
        wheel.parent.mkdir()
        wheel.write_text(f"Wheel-Version: 1.0\nTag: {tag}\n")

    build_portable_sidecar.verify_macos_wheel_floor(tmp_path, "aarch64-apple-darwin")


def test_embedded_python_environment_removes_host_package_paths(monkeypatch) -> None:
    monkeypatch.setenv("PYTHONPATH", "/host/source")
    monkeypatch.setenv("PYTHONHOME", "/host/python")
    monkeypatch.setenv("PIP_TARGET", "/host/target")
    monkeypatch.setenv("SAFE_BUILD_VALUE", "preserved")

    environment = build_portable_sidecar.embedded_python_environment()

    assert "PYTHONPATH" not in environment
    assert "PYTHONHOME" not in environment
    assert "PIP_TARGET" not in environment
    assert environment["PYTHONNOUSERSITE"] == "1"
    assert environment["SAFE_BUILD_VALUE"] == "preserved"


def test_download_never_sends_github_token_to_asset_host(monkeypatch, tmp_path) -> None:
    captured_request = None

    class Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            self.close()

    def fake_open(request):
        nonlocal captured_request
        captured_request = request
        return Response(b"runtime")

    monkeypatch.setenv("GITHUB_TOKEN", "test-token")
    monkeypatch.setattr(build_portable_sidecar, "urlopen_with_cert_fallback", fake_open)

    output = tmp_path / "runtime.tar.gz"
    build_portable_sidecar.download("https://example.invalid/runtime.tar.gz", output)

    assert output.read_bytes() == b"runtime"
    assert captured_request.full_url == "https://example.invalid/runtime.tar.gz"
    assert captured_request.get_header("Authorization") is None
