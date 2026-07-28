from __future__ import annotations

import importlib.util
import json
import struct
import sys
from pathlib import Path

import pytest

SCRIPT_PATH = (
    Path(__file__).resolve().parents[2] / "desktop" / "scripts" / "verify_linux_launcher_transform.py"
)
sys.path.insert(0, str(SCRIPT_PATH.parent))
SPEC = importlib.util.spec_from_file_location("verify_linux_launcher_transform", SCRIPT_PATH)
assert SPEC and SPEC.loader
verify_linux_launcher_transform = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = verify_linux_launcher_transform
SPEC.loader.exec_module(verify_linux_launcher_transform)

ELF_HEADER = struct.Struct("<16sHHIQQQIHHHHHH")
PROGRAM_HEADER = struct.Struct("<IIQQQQQQ")
SECTION_HEADER = struct.Struct("<IIQQQQIIQQ")
DYNAMIC_ENTRY = struct.Struct("<qQ")
NOTE_HEADER = struct.Struct("<III")


def build_elf(
    path: Path,
    *,
    runpath: bool,
    load_flags: int = 5,
    load_offset: int = 0,
    stack_flags: int = 6,
    load_file_size: int | None = None,
    load_memory_size: int | None = None,
    dynamic_segment_offset: int | None = None,
    dynamic_segment_file_size: int | None = None,
    stack_offset: int = 0,
    needed_library: bytes = b"libc.so.6",
    string_table_size: int = 64,
    build_id: bytes = bytes.fromhex("ab" * 20),
    text: bytes = b"stable text code",
    program_headers_offset: int = ELF_HEADER.size,
    section_headers_offset: int = 0x400,
    program_header_count: int = 4,
) -> None:
    base_address = 0
    text_offset = 0x200
    dynstr_offset = 0x220
    dynamic_offset = 0x260
    dynamic_size = 96
    note_offset = 0x2D0
    names_offset = 0x310
    payload_size = max(
        section_headers_offset + 6 * SECTION_HEADER.size,
        program_headers_offset + program_header_count * PROGRAM_HEADER.size,
        0x580,
    )
    payload = bytearray(payload_size)

    ident = b"\x7fELF" + bytes([2, 1, 1, 0, 0]) + bytes(7)
    ELF_HEADER.pack_into(
        payload,
        0,
        ident,
        3,
        62,
        1,
        base_address + text_offset,
        program_headers_offset,
        section_headers_offset,
        0,
        ELF_HEADER.size,
        PROGRAM_HEADER.size,
        program_header_count,
        SECTION_HEADER.size,
        6,
        5,
    )
    dynamic_segment_size = dynamic_segment_file_size or dynamic_size
    PROGRAM_HEADER.pack_into(
        payload,
        program_headers_offset,
        6,
        4,
        program_headers_offset,
        program_headers_offset,
        program_headers_offset,
        program_header_count * PROGRAM_HEADER.size,
        program_header_count * PROGRAM_HEADER.size,
        8,
    )
    PROGRAM_HEADER.pack_into(
        payload,
        program_headers_offset + PROGRAM_HEADER.size,
        1,
        load_flags,
        load_offset,
        base_address,
        base_address,
        load_file_size or names_offset,
        load_memory_size or names_offset,
        0x1000,
    )
    PROGRAM_HEADER.pack_into(
        payload,
        program_headers_offset + 2 * PROGRAM_HEADER.size,
        2,
        6,
        dynamic_segment_offset or dynamic_offset,
        base_address + dynamic_offset,
        base_address + dynamic_offset,
        dynamic_segment_size,
        dynamic_segment_size,
        8,
    )
    PROGRAM_HEADER.pack_into(
        payload,
        program_headers_offset + 3 * PROGRAM_HEADER.size,
        0x6474E551,
        stack_flags,
        stack_offset,
        0,
        0,
        0,
        0,
        16,
    )

    payload[text_offset : text_offset + 16] = text.ljust(16, b"\0")[:16]
    base_strings = b"\0" + needed_library + b"\0"
    runtime_path_offset = len(base_strings)
    dynamic_strings = (base_strings + b"$ORIGIN/../lib\0" if runpath else base_strings).ljust(64, b"\0")
    payload[dynstr_offset : dynstr_offset + 64] = dynamic_strings
    entries = [
        (1, 1),
        (5, base_address + dynstr_offset),
        (10, string_table_size),
    ]
    if runpath:
        entries.append((29, runtime_path_offset))
    entries.append((0, 0))
    dynamic_payload = b"".join(DYNAMIC_ENTRY.pack(*entry) for entry in entries).ljust(dynamic_size, b"\0")
    payload[dynamic_offset : dynamic_offset + dynamic_size] = dynamic_payload

    note = NOTE_HEADER.pack(4, len(build_id), 3) + b"GNU\0" + build_id
    payload[note_offset : note_offset + len(note)] = note
    names = b"\0.text\0.dynstr\0.dynamic\0.note.gnu.build-id\0.shstrtab\0"
    payload[names_offset : names_offset + len(names)] = names
    name_offsets = {
        ".text": names.index(b".text"),
        ".dynstr": names.index(b".dynstr"),
        ".dynamic": names.index(b".dynamic"),
        ".note.gnu.build-id": names.index(b".note.gnu.build-id"),
        ".shstrtab": names.index(b".shstrtab"),
    }
    sections = [
        (0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        (
            name_offsets[".text"],
            1,
            0x6,
            base_address + text_offset,
            text_offset,
            16,
            0,
            0,
            16,
            0,
        ),
        (
            name_offsets[".dynstr"],
            3,
            0x2,
            base_address + dynstr_offset,
            dynstr_offset,
            64,
            0,
            0,
            1,
            0,
        ),
        (
            name_offsets[".dynamic"],
            6,
            0x3,
            base_address + dynamic_offset,
            dynamic_offset,
            dynamic_size,
            2,
            0,
            8,
            16,
        ),
        (
            name_offsets[".note.gnu.build-id"],
            7,
            0x2,
            base_address + note_offset,
            note_offset,
            len(note),
            0,
            0,
            4,
            0,
        ),
        (
            name_offsets[".shstrtab"],
            3,
            0,
            0,
            names_offset,
            len(names),
            0,
            0,
            1,
            0,
        ),
    ]
    for index, section in enumerate(sections):
        SECTION_HEADER.pack_into(
            payload,
            section_headers_offset + index * SECTION_HEADER.size,
            *section,
        )
    path.write_bytes(payload)


def test_linuxdeploy_runtime_path_transform_is_attested(tmp_path) -> None:
    pre_bundle = tmp_path / "pre-launcher"
    packaged = tmp_path / "packaged-launcher"
    build_elf(pre_bundle, runpath=False)
    build_elf(packaged, runpath=True)

    receipt = verify_linux_launcher_transform.create_receipt(pre_bundle, packaged)

    assert receipt["result"] == "passed"
    assert receipt["pre_bundle"]["sha256"] != receipt["packaged"]["sha256"]
    assert receipt["packaged"]["runtime_paths"] == [{"tag": "RUNPATH", "value": "$ORIGIN/../lib"}]
    assert {item["name"] for item in receipt["proof"]["changed_sections"]} == {
        ".dynamic",
        ".dynstr",
    }
    assert receipt["proof"]["changed_dynamic_tags"] == ["RUNPATH"]
    verify_linux_launcher_transform.validate_receipt(receipt)


def test_linuxdeploy_transform_rejects_unrelated_dynstr_corruption(tmp_path) -> None:
    pre_bundle = tmp_path / "pre-launcher"
    packaged = tmp_path / "packaged-launcher"
    build_elf(pre_bundle, runpath=False)
    build_elf(packaged, runpath=True)
    payload = bytearray(packaged.read_bytes())
    payload[0x220 + 50] = 1
    packaged.write_bytes(payload)

    with pytest.raises(RuntimeError, match="outside the exact expected runtime-path"):
        verify_linux_launcher_transform.create_receipt(pre_bundle, packaged)


def test_linuxdeploy_transform_allows_only_section_header_table_relocation(tmp_path) -> None:
    pre_bundle = tmp_path / "pre-launcher"
    packaged = tmp_path / "packaged-launcher"
    build_elf(pre_bundle, runpath=False, section_headers_offset=0x400)
    build_elf(packaged, runpath=True, section_headers_offset=0x500)

    receipt = verify_linux_launcher_transform.create_receipt(pre_bundle, packaged)

    assert receipt["proof"]["elf_header_transform"] == {
        "pre_bundle": {
            "program_header_offset": ELF_HEADER.size,
            "section_header_offset": 0x400,
            "program_header_count": 4,
            "section_name_index": 5,
            "shstrtab_index": 5,
        },
        "packaged": {
            "program_header_offset": ELF_HEADER.size,
            "section_header_offset": 0x500,
            "program_header_count": 4,
            "section_name_index": 5,
            "shstrtab_index": 5,
        },
    }


def test_linuxdeploy_transform_rejects_program_header_table_relocation(tmp_path) -> None:
    pre_bundle = tmp_path / "pre-launcher"
    packaged = tmp_path / "packaged-launcher"
    build_elf(pre_bundle, runpath=False)
    build_elf(packaged, runpath=True, program_headers_offset=0x80)

    with pytest.raises(RuntimeError, match="PT_PHDR without adding"):
        verify_linux_launcher_transform.create_receipt(pre_bundle, packaged)


def test_linuxdeploy_transform_rejects_unauthorized_extra_program_header(
    tmp_path,
) -> None:
    pre_bundle = tmp_path / "pre-launcher"
    packaged = tmp_path / "packaged-launcher"
    build_elf(pre_bundle, runpath=False)
    build_elf(packaged, runpath=True, program_header_count=5)

    with pytest.raises(RuntimeError, match="unauthorized program header"):
        verify_linux_launcher_transform.create_receipt(pre_bundle, packaged)


def test_linuxdeploy_transform_rejects_pt_load_permission_change(tmp_path) -> None:
    pre_bundle = tmp_path / "pre-launcher"
    packaged = tmp_path / "packaged-launcher"
    build_elf(pre_bundle, runpath=False)
    build_elf(packaged, runpath=True, load_flags=7)

    with pytest.raises(RuntimeError, match="writable executable PT_LOAD"):
        verify_linux_launcher_transform.create_receipt(pre_bundle, packaged)


def test_linuxdeploy_transform_rejects_executable_gnu_stack(tmp_path) -> None:
    pre_bundle = tmp_path / "pre-launcher"
    packaged = tmp_path / "packaged-launcher"
    build_elf(pre_bundle, runpath=False)
    build_elf(packaged, runpath=True, stack_flags=7)

    with pytest.raises(RuntimeError, match="executable or ambiguous GNU stack"):
        verify_linux_launcher_transform.create_receipt(pre_bundle, packaged)


def test_linuxdeploy_transform_rejects_stable_code_change(tmp_path) -> None:
    pre_bundle = tmp_path / "pre-launcher"
    packaged = tmp_path / "packaged-launcher"
    build_elf(pre_bundle, runpath=False)
    build_elf(packaged, runpath=True, text=b"changed text code")

    with pytest.raises(RuntimeError, match="stable ELF section .text"):
        verify_linux_launcher_transform.create_receipt(pre_bundle, packaged)


def test_linuxdeploy_transform_rejects_changed_build_identity(tmp_path) -> None:
    pre_bundle = tmp_path / "pre-launcher"
    packaged = tmp_path / "packaged-launcher"
    build_elf(pre_bundle, runpath=False)
    build_elf(packaged, runpath=True, build_id=bytes.fromhex("cd" * 20))

    with pytest.raises(RuntimeError, match="ELF identity or GNU build identity"):
        verify_linux_launcher_transform.create_receipt(pre_bundle, packaged)


def test_linuxdeploy_transform_rejects_non_path_dynamic_change(tmp_path) -> None:
    pre_bundle = tmp_path / "pre-launcher"
    packaged = tmp_path / "packaged-launcher"
    build_elf(pre_bundle, runpath=False)
    build_elf(packaged, runpath=True, needed_library=b"libm.so.6")

    with pytest.raises(RuntimeError, match="non-runtime-path dynamic entry"):
        verify_linux_launcher_transform.create_receipt(pre_bundle, packaged)


def test_linuxdeploy_transform_rejects_section_to_segment_change(tmp_path) -> None:
    pre_bundle = tmp_path / "pre-launcher"
    packaged = tmp_path / "packaged-launcher"
    build_elf(pre_bundle, runpath=False)
    build_elf(packaged, runpath=True, load_file_size=0x2A0)

    with pytest.raises(RuntimeError, match="beyond runtime-section remapping"):
        verify_linux_launcher_transform.create_receipt(pre_bundle, packaged)


def test_linuxdeploy_transform_rejects_unapproved_program_offset_change(tmp_path) -> None:
    pre_bundle = tmp_path / "pre-launcher"
    packaged = tmp_path / "packaged-launcher"
    build_elf(pre_bundle, runpath=False)
    build_elf(packaged, runpath=True, stack_offset=8)

    with pytest.raises(RuntimeError, match="beyond runtime-section remapping"):
        verify_linux_launcher_transform.create_receipt(pre_bundle, packaged)


def test_linuxdeploy_transform_rejects_same_membership_pt_load_coverage_shift(
    tmp_path,
) -> None:
    pre_bundle = tmp_path / "pre-launcher"
    packaged = tmp_path / "packaged-launcher"
    build_elf(pre_bundle, runpath=False)
    build_elf(
        packaged,
        runpath=True,
        load_offset=0x100,
        load_file_size=0x1D0,
        load_memory_size=0x2D0,
    )

    with pytest.raises(RuntimeError, match="incongruent PT_LOAD"):
        verify_linux_launcher_transform.create_receipt(pre_bundle, packaged)


def test_linuxdeploy_transform_rejects_unattributed_dynamic_segment_coverage(
    tmp_path,
) -> None:
    pre_bundle = tmp_path / "pre-launcher"
    packaged = tmp_path / "packaged-launcher"
    build_elf(pre_bundle, runpath=False)
    build_elf(
        packaged,
        runpath=True,
        dynamic_segment_offset=0x250,
        dynamic_segment_file_size=80,
    )

    with pytest.raises(RuntimeError, match="does not exactly map"):
        verify_linux_launcher_transform.create_receipt(pre_bundle, packaged)


def test_linuxdeploy_transform_rejects_unbounded_dynamic_string_size(tmp_path) -> None:
    pre_bundle = tmp_path / "pre-launcher"
    packaged = tmp_path / "packaged-launcher"
    build_elf(pre_bundle, runpath=False)
    build_elf(packaged, runpath=True, string_table_size=65_535)

    with pytest.raises(RuntimeError, match="DT_STRSZ must occur once"):
        verify_linux_launcher_transform.create_receipt(pre_bundle, packaged)


def test_receipt_rejects_wrong_identity_hash_path_and_stable_digest(tmp_path) -> None:
    pre_bundle = tmp_path / "pre-launcher"
    packaged = tmp_path / "packaged-launcher"
    build_elf(pre_bundle, runpath=False)
    build_elf(packaged, runpath=True)
    valid = verify_linux_launcher_transform.create_receipt(pre_bundle, packaged)
    cases = [
        (("target",), "not-linux", "identity is invalid"),
        (("transformation_kind",), "unbounded", "identity is invalid"),
        (("pre_bundle", "sha256"), "malformed", "SHA-256 is invalid"),
        (
            ("packaged", "runtime_paths"),
            [{"tag": "RUNPATH", "value": "$ORIGIN"}],
            "runtime-path evidence is invalid",
        ),
        (
            ("proof", "stable_sections", "packaged_sha256"),
            "e" * 64,
            "Stable-section proof is invalid",
        ),
        (
            ("proof", "dynamic_string_sizes", "packaged"),
            65_535,
            "Dynamic string-table size proof is invalid",
        ),
        (
            ("proof", "elf_header_transform", "packaged", "program_header_offset"),
            0x80,
            "program-header table moved without an added relocation segment",
        ),
    ]
    for keys, value, message in cases:
        receipt = json.loads(json.dumps(valid))
        target = receipt
        for key in keys[:-1]:
            target = target[key]
        target[keys[-1]] = value
        with pytest.raises(RuntimeError, match=message):
            verify_linux_launcher_transform.validate_receipt(receipt)


def test_receipt_rejects_unauthorized_section_name_table_change(tmp_path) -> None:
    pre_bundle = tmp_path / "pre-launcher"
    packaged = tmp_path / "packaged-launcher"
    build_elf(pre_bundle, runpath=False)
    build_elf(packaged, runpath=True)
    receipt = verify_linux_launcher_transform.create_receipt(pre_bundle, packaged)
    receipt["proof"]["elf_header_transform"]["packaged"]["section_name_index"] = 4

    with pytest.raises(RuntimeError, match=r"\.shstrtab"):
        verify_linux_launcher_transform.validate_receipt(receipt)
