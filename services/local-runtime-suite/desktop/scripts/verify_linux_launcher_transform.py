from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any

LINUX_TARGET = "x86_64-unknown-linux-gnu"
TRANSFORMATION_KIND = "linuxdeploy-rpath-v2"
EXPECTED_RUNTIME_PATH = "$ORIGIN/../lib"
SHA256 = re.compile(r"^[a-f0-9]{64}$")

ELF_HEADER = struct.Struct("<16sHHIQQQIHHHHHH")
PROGRAM_HEADER = struct.Struct("<IIQQQQQQ")
SECTION_HEADER = struct.Struct("<IIQQQQIIQQ")
DYNAMIC_ENTRY = struct.Struct("<qQ")
NOTE_HEADER = struct.Struct("<III")
SYMBOL_ENTRY = struct.Struct("<IBBHQQ")

PT_LOAD = 1
PT_DYNAMIC = 2
PT_PHDR = 6
PT_GNU_STACK = 0x6474E551
SHT_SYMTAB = 2
SHT_STRTAB = 3
SHT_RELA = 4
SHT_NOBITS = 8
SHT_DYNAMIC = 6
SHT_NOTE = 7
SHT_REL = 9
SHT_DYNSYM = 11
DT_NULL = 0
DT_NEEDED = 1
DT_STRTAB = 5
DT_STRSZ = 10
DT_SONAME = 14
DT_RPATH = 15
DT_RUNPATH = 29
DT_AUXILIARY = 0x7FFFFFFD
DT_FILTER = 0x7FFFFFFF
NT_GNU_BUILD_ID = 3

PROGRAM_TYPE_NAMES = {
    0: "PT_NULL",
    PT_LOAD: "PT_LOAD",
    PT_DYNAMIC: "PT_DYNAMIC",
    3: "PT_INTERP",
    4: "PT_NOTE",
    PT_PHDR: "PT_PHDR",
    7: "PT_TLS",
    0x6474E550: "PT_GNU_EH_FRAME",
    PT_GNU_STACK: "PT_GNU_STACK",
    0x6474E552: "PT_GNU_RELRO",
    0x6474E553: "PT_GNU_PROPERTY",
}
DYNAMIC_TAG_NAMES = {
    DT_NEEDED: "NEEDED",
    DT_STRTAB: "STRTAB",
    DT_STRSZ: "STRSZ",
    DT_SONAME: "SONAME",
    DT_RPATH: "RPATH",
    DT_RUNPATH: "RUNPATH",
    DT_AUXILIARY: "AUXILIARY",
    DT_FILTER: "FILTER",
}
STRING_DYNAMIC_TAGS = {
    DT_NEEDED,
    DT_SONAME,
    DT_RPATH,
    DT_RUNPATH,
    DT_AUXILIARY,
    DT_FILTER,
}
ALLOWED_DYNAMIC_TAGS = {DT_STRTAB, DT_STRSZ, DT_RPATH, DT_RUNPATH}
TOP_LEVEL_FIELDS = {
    "schema_version",
    "target",
    "result",
    "transformation_kind",
    "pre_bundle",
    "packaged",
    "elf_identity",
    "proof",
}
LAUNCHER_FIELDS = {"sha256", "runtime_paths"}
IDENTITY_FIELDS = {
    "class",
    "byte_order",
    "abi",
    "abi_version",
    "machine",
    "file_type",
    "entry_point",
    "flags",
    "build_id",
}
PROOF_FIELDS = {
    "elf_header",
    "elf_header_transform",
    "program_headers",
    "stable_sections",
    "changed_sections",
    "changed_dynamic_tags",
    "dynamic_string_sizes",
    "runtime_path_string",
}
ELF_HEADER_TRANSFORM_FIELDS = {
    "program_header_offset",
    "section_header_offset",
    "program_header_count",
    "section_name_index",
    "shstrtab_index",
}
ELF_HEADER_TRANSFORM_KEYS = ELF_HEADER_TRANSFORM_FIELDS - {"shstrtab_index"}
STABLE_SECTION_FIELDS = {"pre_bundle_sha256", "packaged_sha256", "count"}
DYNAMIC_STRING_SIZE_FIELDS = {"pre_bundle", "packaged"}
RUNTIME_PATH_STRING_FIELDS = {
    "tag",
    "value",
    "offset",
    "byte_length",
    "mode",
    "preserved_sha256",
}
PROGRAM_PROOF_FIELDS = {"pre_bundle", "packaged", "changed_indices"}
PROGRAM_FIELDS = {
    "index",
    "type",
    "type_name",
    "flags",
    "offset",
    "virtual_address",
    "physical_address",
    "file_size",
    "memory_size",
    "alignment",
    "sections",
}
CHANGED_SECTION_FIELDS = {
    "name",
    "pre_index",
    "packaged_index",
    "pre_sha256",
    "packaged_sha256",
    "pre_address",
    "packaged_address",
    "pre_offset",
    "packaged_offset",
    "pre_size",
    "packaged_size",
    "pre_alignment",
    "packaged_alignment",
}


def _require_exact_fields(value: Any, fields: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != fields:
        actual = sorted(value) if isinstance(value, dict) else type(value).__name__
        raise RuntimeError(f"{label} fields are {actual}; expected {sorted(fields)}.")
    return value


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _checked_slice(payload: bytes, offset: int, size: int, label: str) -> bytes:
    if offset < 0 or size < 0 or offset > len(payload) or size > len(payload) - offset:
        raise RuntimeError(f"{label} extends beyond the ELF file.")
    return payload[offset : offset + size]


def _read_c_string(payload: bytes, offset: int, label: str) -> str:
    if offset < 0 or offset >= len(payload):
        raise RuntimeError(f"{label} has an invalid string offset.")
    end = payload.find(b"\0", offset)
    if end < 0:
        raise RuntimeError(f"{label} contains an unterminated string.")
    try:
        return payload[offset:end].decode("utf-8")
    except UnicodeDecodeError as error:
        raise RuntimeError(f"{label} contains a non-UTF-8 string.") from error


@dataclass(frozen=True)
class Section:
    index: int
    name: str
    type: int
    flags: int
    address: int
    offset: int
    size: int
    link: int
    info: int
    alignment: int
    entry_size: int
    data: bytes

    def stable_record(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "name": self.name,
            "type": self.type,
            "flags": self.flags,
            "address": self.address,
            "offset": self.offset,
            "size": self.size,
            "link": self.link,
            "info": self.info,
            "alignment": self.alignment,
            "entry_size": self.entry_size,
            "sha256": _sha256_bytes(self.data),
        }

    def transform_record(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "name": self.name,
            "type": self.type,
            "flags": self.flags,
            "address": self.address,
            "link": self.link,
            "info": self.info,
            "alignment": self.alignment,
            "entry_size": self.entry_size,
        }


@dataclass(frozen=True)
class ProgramHeader:
    index: int
    type: int
    flags: int
    offset: int
    virtual_address: int
    physical_address: int
    file_size: int
    memory_size: int
    alignment: int


class ElfFile:
    def __init__(self, path: Path) -> None:
        if not path.is_file() or path.is_symlink():
            raise RuntimeError(
                f"Launcher must be a regular, non-symbolic-link file: {path}."
            )
        self.path = path
        self.payload = path.read_bytes()
        self.header = self._parse_header()
        self.sections = self._parse_sections()
        self.program_headers = self._parse_program_headers()
        self.dynamic_entries = self._parse_dynamic_entries()
        self.runtime_paths = [
            {
                "tag": DYNAMIC_TAG_NAMES[entry["tag"]],
                "value": entry["value"],
            }
            for entry in self.dynamic_entries
            if entry["tag"] in {DT_RPATH, DT_RUNPATH}
        ]
        self.build_id = self._parse_build_id()

    def _parse_header(self) -> dict[str, Any]:
        if len(self.payload) < ELF_HEADER.size:
            raise RuntimeError("Launcher is shorter than an ELF64 header.")
        values = ELF_HEADER.unpack_from(self.payload)
        ident = values[0]
        if ident[:4] != b"\x7fELF":
            raise RuntimeError("Launcher is not an ELF file.")
        if ident[4] != 2 or ident[5] != 1:
            raise RuntimeError("Launcher must be a 64-bit little-endian ELF file.")
        if ident[6] != 1 or values[3] != 1:
            raise RuntimeError("Launcher uses an unsupported ELF version.")
        header = {
            "class": "ELF64",
            "byte_order": "little",
            "ident_version": ident[6],
            "abi": ident[7],
            "abi_version": ident[8],
            "file_type": values[1],
            "machine": values[2],
            "version": values[3],
            "entry_point": values[4],
            "program_header_offset": values[5],
            "section_header_offset": values[6],
            "flags": values[7],
            "elf_header_size": values[8],
            "program_header_entry_size": values[9],
            "program_header_count": values[10],
            "section_header_entry_size": values[11],
            "section_header_count": values[12],
            "section_name_index": values[13],
        }
        if (
            header["elf_header_size"] != ELF_HEADER.size
            or header["program_header_entry_size"] != PROGRAM_HEADER.size
            or header["section_header_entry_size"] != SECTION_HEADER.size
            or header["program_header_count"] in {0, 0xFFFF}
            or header["section_header_count"] in {0, 0xFFFF}
            or header["section_name_index"] in {0xFFFF}
            or header["section_name_index"] >= header["section_header_count"]
        ):
            raise RuntimeError(
                "Launcher uses unsupported or malformed ELF header tables."
            )
        _checked_slice(
            self.payload,
            header["program_header_offset"],
            header["program_header_count"] * PROGRAM_HEADER.size,
            "Program-header table",
        )
        _checked_slice(
            self.payload,
            header["section_header_offset"],
            header["section_header_count"] * SECTION_HEADER.size,
            "Section-header table",
        )
        return header

    def _parse_sections(self) -> list[Section]:
        raw_headers = []
        for index in range(self.header["section_header_count"]):
            offset = self.header["section_header_offset"] + index * SECTION_HEADER.size
            raw_headers.append(SECTION_HEADER.unpack_from(self.payload, offset))
        names_header = raw_headers[self.header["section_name_index"]]
        names = _checked_slice(
            self.payload,
            names_header[4],
            names_header[5],
            "Section-name string table",
        )
        sections: list[Section] = []
        seen_names: set[str] = set()
        for index, raw in enumerate(raw_headers):
            name = (
                ""
                if index == 0
                else _read_c_string(names, raw[0], f"Section {index} name")
            )
            if name and name in seen_names:
                raise RuntimeError(f"Launcher contains duplicate section name {name}.")
            seen_names.add(name)
            data = (
                b""
                if raw[1] == SHT_NOBITS
                else _checked_slice(
                    self.payload, raw[4], raw[5], f"Section {name or index}"
                )
            )
            sections.append(
                Section(
                    index=index,
                    name=name,
                    type=raw[1],
                    flags=raw[2],
                    address=raw[3],
                    offset=raw[4],
                    size=raw[5],
                    link=raw[6],
                    info=raw[7],
                    alignment=raw[8],
                    entry_size=raw[9],
                    data=data,
                )
            )
        if sections[self.header["section_name_index"]].name != ".shstrtab":
            raise RuntimeError(
                "ELF section-name index does not identify the .shstrtab section."
            )
        return sections

    def _parse_program_headers(self) -> list[ProgramHeader]:
        headers = []
        for index in range(self.header["program_header_count"]):
            offset = self.header["program_header_offset"] + index * PROGRAM_HEADER.size
            raw = PROGRAM_HEADER.unpack_from(self.payload, offset)
            headers.append(
                ProgramHeader(
                    index=index,
                    type=raw[0],
                    flags=raw[1],
                    offset=raw[2],
                    virtual_address=raw[3],
                    physical_address=raw[4],
                    file_size=raw[5],
                    memory_size=raw[6],
                    alignment=raw[7],
                )
            )
        if not any(header.type == PT_LOAD for header in headers):
            raise RuntimeError("Launcher contains no PT_LOAD segment.")
        if not any(header.type == PT_DYNAMIC for header in headers):
            raise RuntimeError("Launcher contains no PT_DYNAMIC segment.")
        if not any(header.type == PT_PHDR for header in headers):
            raise RuntimeError("Launcher contains no PT_PHDR segment.")
        if not any(header.type == PT_GNU_STACK for header in headers):
            raise RuntimeError("Launcher contains no PT_GNU_STACK declaration.")
        for header in headers:
            if (
                header.type == PT_LOAD
                and header.alignment > 1
                and header.offset % header.alignment
                != header.virtual_address % header.alignment
            ):
                raise RuntimeError(
                    "Launcher contains an incongruent PT_LOAD file mapping."
                )
        return headers

    def _parse_dynamic_entries(self) -> list[dict[str, Any]]:
        dynamic_sections = [
            section for section in self.sections if section.type == SHT_DYNAMIC
        ]
        if len(dynamic_sections) != 1:
            raise RuntimeError(
                f"Launcher must contain exactly one dynamic section; found {len(dynamic_sections)}."
            )
        dynamic = dynamic_sections[0]
        if (
            dynamic.entry_size != DYNAMIC_ENTRY.size
            or dynamic.size % dynamic.entry_size
        ):
            raise RuntimeError(
                "Launcher dynamic section has an unsupported entry layout."
            )
        if dynamic.link >= len(self.sections):
            raise RuntimeError(
                "Launcher dynamic section has an invalid string-table link."
            )
        strings = self.sections[dynamic.link]
        entries = []
        saw_null = False
        for offset in range(0, dynamic.size, dynamic.entry_size):
            tag, value = DYNAMIC_ENTRY.unpack_from(dynamic.data, offset)
            if tag == DT_NULL:
                saw_null = True
                break
            semantic_value: str | int = (
                _read_c_string(strings.data, value, f"Dynamic tag {tag}")
                if tag in STRING_DYNAMIC_TAGS
                else value
            )
            entries.append({"tag": tag, "value": semantic_value, "raw_value": value})
        if not saw_null:
            raise RuntimeError(
                "Launcher dynamic section has no terminating DT_NULL entry."
            )
        string_sizes = [entry["value"] for entry in entries if entry["tag"] == DT_STRSZ]
        if len(string_sizes) != 1 or string_sizes[0] != strings.size:
            raise RuntimeError(
                "Launcher DT_STRSZ must occur once and equal the linked string-table size."
            )
        return entries

    def _parse_build_id(self) -> str:
        identities = []
        for section in self.sections:
            if section.type != SHT_NOTE:
                continue
            offset = 0
            while offset < len(section.data):
                if len(section.data) - offset < NOTE_HEADER.size:
                    raise RuntimeError(f"ELF note section {section.name} is truncated.")
                name_size, description_size, note_type = NOTE_HEADER.unpack_from(
                    section.data, offset
                )
                offset += NOTE_HEADER.size
                name = _checked_slice(section.data, offset, name_size, "ELF note name")
                offset += (name_size + 3) & ~3
                description = _checked_slice(
                    section.data, offset, description_size, "ELF note description"
                )
                offset += (description_size + 3) & ~3
                if name.rstrip(b"\0") == b"GNU" and note_type == NT_GNU_BUILD_ID:
                    identities.append(description.hex())
        if len(identities) != 1 or not identities[0]:
            raise RuntimeError(
                f"Launcher must contain exactly one GNU build identity; found {len(identities)}."
            )
        return identities[0]

    def identity(self) -> dict[str, Any]:
        return {
            "class": self.header["class"],
            "byte_order": self.header["byte_order"],
            "abi": self.header["abi"],
            "abi_version": self.header["abi_version"],
            "machine": self.header["machine"],
            "file_type": self.header["file_type"],
            "entry_point": self.header["entry_point"],
            "flags": self.header["flags"],
            "build_id": self.build_id,
        }

    def semantic_header(self) -> dict[str, Any]:
        return {
            key: value
            for key, value in self.header.items()
            if key not in ELF_HEADER_TRANSFORM_KEYS
        }

    def header_transform(self) -> dict[str, int]:
        transform = {key: self.header[key] for key in ELF_HEADER_TRANSFORM_KEYS}
        transform["shstrtab_index"] = next(
            section.index for section in self.sections if section.name == ".shstrtab"
        )
        return transform

    def semantic_section_record(self, section: Section) -> dict[str, Any]:
        link_name = None
        if section.link:
            if section.link >= len(self.sections):
                raise RuntimeError(
                    f"ELF section {section.name} has an invalid linked-section index."
                )
            link_name = self.sections[section.link].name
        info: int | str = section.info
        if section.type in {SHT_REL, SHT_RELA} and section.info:
            if section.info >= len(self.sections):
                raise RuntimeError(
                    f"ELF relocation section {section.name} has an invalid target index."
                )
            info = self.sections[section.info].name
        digest = (
            self._semantic_symbol_digest(section)
            if section.type in {SHT_SYMTAB, SHT_DYNSYM}
            else _sha256_bytes(section.data)
        )
        return {
            "name": section.name,
            "type": section.type,
            "flags": section.flags,
            "address": section.address,
            "offset": section.offset,
            "size": section.size,
            "link_name": link_name,
            "info": info,
            "alignment": section.alignment,
            "entry_size": section.entry_size,
            "semantic_sha256": digest,
        }

    def _semantic_symbol_digest(self, section: Section) -> str:
        if (
            section.entry_size != SYMBOL_ENTRY.size
            or section.size % section.entry_size
            or section.link >= len(self.sections)
        ):
            raise RuntimeError(
                f"ELF symbol table {section.name} has an unsupported layout."
            )
        strings = self.sections[section.link]
        if strings.type != SHT_STRTAB:
            raise RuntimeError(
                f"ELF symbol table {section.name} is not linked to a string table."
            )
        records = []
        for offset in range(0, section.size, section.entry_size):
            name_offset, info, other, section_index, value, size = (
                SYMBOL_ENTRY.unpack_from(section.data, offset)
            )
            name = (
                ""
                if name_offset == 0
                else _read_c_string(
                    strings.data, name_offset, f"ELF symbol in {section.name}"
                )
            )
            section_reference: int | str = section_index
            if 0 < section_index < 0xFF00:
                if section_index >= len(self.sections):
                    raise RuntimeError(
                        f"ELF symbol in {section.name} has an invalid section index."
                    )
                section_reference = self.sections[section_index].name
            records.append(
                {
                    "name": name,
                    "info": info,
                    "other": other,
                    "section": section_reference,
                    "value": value,
                    "size": size,
                }
            )
        return _sha256_bytes(
            json.dumps(records, sort_keys=True, separators=(",", ":")).encode()
        )

    def program_records(self) -> list[dict[str, Any]]:
        return [
            {
                "index": header.index,
                "type": header.type,
                "type_name": PROGRAM_TYPE_NAMES.get(
                    header.type, f"PT_{header.type:#x}"
                ),
                "flags": header.flags,
                "offset": header.offset,
                "virtual_address": header.virtual_address,
                "physical_address": header.physical_address,
                "file_size": header.file_size,
                "memory_size": header.memory_size,
                "alignment": header.alignment,
                "sections": self._sections_in_segment(header),
            }
            for header in self.program_headers
        ]

    def _sections_in_segment(self, header: ProgramHeader) -> list[str]:
        members = []
        for section in self.sections[1:]:
            if section.size == 0 or not section.flags & 0x2:
                continue
            if section.type == SHT_NOBITS:
                inside = (
                    section.address >= header.virtual_address
                    and section.address + section.size
                    <= header.virtual_address + header.memory_size
                )
            else:
                inside = (
                    section.offset >= header.offset
                    and section.offset + section.size
                    <= header.offset + header.file_size
                )
                if section.flags & 0x2:
                    inside = inside and (
                        section.address >= header.virtual_address
                        and section.address + section.size
                        <= header.virtual_address + header.memory_size
                    )
            if inside:
                members.append(section.name)
        return members


def _stable_sections_digest(elf: ElfFile, changed_names: set[str]) -> tuple[str, int]:
    records = [
        elf.semantic_section_record(section)
        for section in elf.sections
        if section.index != 0 and section.name not in changed_names
    ]
    records.sort(key=lambda item: item["name"])
    encoded = json.dumps(records, sort_keys=True, separators=(",", ":")).encode()
    return _sha256_bytes(encoded), len(records)


def _compare_program_headers(
    before: list[dict[str, Any]],
    after: list[dict[str, Any]],
    changed_sections: list[dict[str, Any]],
    header_transform: dict[str, dict[str, int]],
) -> list[int]:
    changed_section_names = {section["name"] for section in changed_sections}
    if changed_section_names != {".dynamic", ".dynstr"}:
        raise RuntimeError("Program-header comparison requires both runtime sections.")
    if len(after) not in {len(before), len(before) + 1}:
        raise RuntimeError(
            "linuxdeploy added more than the single approved runtime relocation segment."
        )
    for label, records in (("pre-bundle", before), ("packaged", after)):
        if any(
            record["type"] == PT_LOAD and record["flags"] & 0x3 == 0x3
            for record in records
        ):
            raise RuntimeError(
                f"{label} launcher contains a writable executable PT_LOAD."
            )
        stacks = [record for record in records if record["type"] == PT_GNU_STACK]
        if len(stacks) != 1 or stacks[0]["flags"] & 0x1:
            raise RuntimeError(
                f"{label} launcher has an executable or ambiguous GNU stack."
            )

    def one(records: list[dict[str, Any]], kind: int, label: str) -> dict[str, Any]:
        matches = [record for record in records if record["type"] == kind]
        if len(matches) != 1:
            raise RuntimeError(
                f"{label} launcher must contain exactly one {PROGRAM_TYPE_NAMES[kind]}."
            )
        return matches[0]

    def normalized(record: dict[str, Any]) -> dict[str, Any]:
        return {
            key: (
                sorted(set(value) - changed_section_names)
                if key == "sections"
                else value
            )
            for key, value in record.items()
            if key != "index"
        }

    before_phdr = one(before, PT_PHDR, "Pre-bundle")
    after_phdr = one(after, PT_PHDR, "Packaged")
    before_dynamic = one(before, PT_DYNAMIC, "Pre-bundle")
    after_dynamic = one(after, PT_DYNAMIC, "Packaged")
    before_regular = [
        record for record in before if record["type"] not in {PT_PHDR, PT_DYNAMIC}
    ]
    after_regular = [
        record for record in after if record["type"] not in {PT_PHDR, PT_DYNAMIC}
    ]
    unmatched_after = list(after_regular)
    matched_pairs = []
    for left in before_regular:
        candidates = [
            right for right in unmatched_after if normalized(left) == normalized(right)
        ]
        if len(candidates) != 1:
            raise RuntimeError(
                "linuxdeploy changed an existing program header beyond runtime-section remapping."
            )
        right = candidates[0]
        unmatched_after.remove(right)
        matched_pairs.append((left, right))

    added_count = len(after) - len(before)
    if len(unmatched_after) != added_count:
        raise RuntimeError(
            "linuxdeploy program-header inventory does not match one optional relocation segment."
        )

    transforms = {
        "pre_bundle": header_transform["pre_bundle"],
        "packaged": header_transform["packaged"],
    }
    for label, record, transform in (
        ("pre-bundle", before_phdr, transforms["pre_bundle"]),
        ("packaged", after_phdr, transforms["packaged"]),
    ):
        expected_size = transform["program_header_count"] * PROGRAM_HEADER.size
        if (
            record["flags"] != 4
            or record["alignment"] != 8
            or record["sections"]
            or record["offset"] != transform["program_header_offset"]
            or record["virtual_address"] != record["offset"]
            or record["physical_address"] != record["offset"]
            or record["file_size"] != expected_size
            or record["memory_size"] != expected_size
        ):
            raise RuntimeError(
                f"{label} PT_PHDR does not exactly attest its program-header table."
            )
    if not added_count and normalized(before_phdr) != normalized(after_phdr):
        raise RuntimeError(
            "linuxdeploy changed PT_PHDR without adding a relocation segment."
        )

    changed_by_name = {section["name"]: section for section in changed_sections}
    dynamic = changed_by_name[".dynamic"]
    for label, record, prefix in (
        ("pre-bundle", before_dynamic, "pre"),
        ("packaged", after_dynamic, "packaged"),
    ):
        if (
            record["flags"] != 6
            or record["alignment"] != 8
            or record["offset"] != dynamic[f"{prefix}_offset"]
            or record["virtual_address"] != dynamic[f"{prefix}_address"]
            or record["physical_address"] != dynamic[f"{prefix}_address"]
            or record["file_size"] != dynamic[f"{prefix}_size"]
            or record["memory_size"] != dynamic[f"{prefix}_size"]
            or record["sections"] != [".dynamic"]
        ):
            raise RuntimeError(
                f"{label} PT_DYNAMIC does not exactly map the .dynamic section."
            )

    added_indices = []
    if added_count:
        added = unmatched_after[0]
        runtime_sections = [changed_by_name[".dynamic"], changed_by_name[".dynstr"]]
        start = transforms["packaged"]["program_header_offset"]
        table_end = (
            start + transforms["packaged"]["program_header_count"] * PROGRAM_HEADER.size
        )
        file_end = max(
            table_end,
            *(
                section["packaged_offset"] + section["packaged_size"]
                for section in runtime_sections
            ),
        )
        memory_end = max(
            table_end,
            *(
                section["packaged_address"] + section["packaged_size"]
                for section in runtime_sections
            ),
        )
        section_alignment = max(
            section["packaged_alignment"] for section in runtime_sections
        )
        expected_file_size = _align_up(file_end - start, section_alignment)
        expected_memory_size = _align_up(memory_end - start, section_alignment)
        if (
            added["type"] != PT_LOAD
            or added["flags"] != 6
            or added["alignment"] < 4096
            or added["alignment"] & (added["alignment"] - 1)
            or added["offset"] != start
            or added["virtual_address"] != start
            or added["physical_address"] != start
            or added["file_size"] != expected_file_size
            or added["memory_size"] != expected_memory_size
            or set(added["sections"]) != changed_section_names
            or len(added["sections"]) != 2
        ):
            raise RuntimeError(
                "linuxdeploy added an unauthorized program header instead of the exact "
                "read/write runtime relocation segment."
            )
        added_indices.append(added["index"])
    elif unmatched_after:
        raise RuntimeError("linuxdeploy produced an unexplained program header.")

    changed_indices = {
        after_phdr["index"],
        after_dynamic["index"],
        *added_indices,
    }
    changed_indices.update(
        right["index"] for left, right in matched_pairs if left != right
    )
    return sorted(changed_indices)


def _align_up(value: int, alignment: int) -> int:
    if value < 0 or alignment < 1 or alignment & (alignment - 1):
        raise RuntimeError("ELF alignment evidence is invalid.")
    return (value + alignment - 1) & -alignment


def _canonical_dynamic_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [entry for entry in entries if entry["tag"] not in ALLOWED_DYNAMIC_TAGS]


def _attest_runtime_path_string(
    before: Section,
    after: Section,
    path_entry: dict[str, Any],
) -> dict[str, Any]:
    expected = EXPECTED_RUNTIME_PATH.encode("utf-8") + b"\0"
    offset = path_entry["raw_value"]
    if (
        not isinstance(offset, int)
        or isinstance(offset, bool)
        or offset < 0
        or offset > len(after.data)
        or len(expected) > len(after.data) - offset
        or after.data[offset : offset + len(expected)] != expected
    ):
        raise RuntimeError(
            "Packaged runtime-path dynamic entry does not identify the exact expected "
            ".dynstr bytes."
        )

    if offset == len(before.data) and after.data == before.data + expected:
        mode = "append"
        preserved = before.data
    elif (
        len(after.data) == len(before.data)
        and before.data[offset : offset + len(expected)] == b"\0" * len(expected)
        and after.data
        == before.data[:offset] + expected + before.data[offset + len(expected) :]
    ):
        mode = "zero-padding-replacement"
        preserved = before.data[:offset] + before.data[offset + len(expected) :]
    else:
        raise RuntimeError(
            "linuxdeploy changed .dynstr outside the exact expected runtime-path "
            "string span."
        )

    return {
        "tag": DYNAMIC_TAG_NAMES[path_entry["tag"]],
        "value": EXPECTED_RUNTIME_PATH,
        "offset": offset,
        "byte_length": len(expected),
        "mode": mode,
        "preserved_sha256": _sha256_bytes(preserved),
    }


def _header_differences(
    before: dict[str, Any], after: dict[str, Any]
) -> list[dict[str, Any]]:
    return [
        {
            "field": field,
            "pre_bundle": before.get(field),
            "packaged": after.get(field),
        }
        for field in sorted(set(before) | set(after))
        if before.get(field) != after.get(field)
    ]


def create_receipt(pre_bundle: Path, packaged: Path) -> dict[str, Any]:
    before = ElfFile(pre_bundle)
    after = ElfFile(packaged)
    header_differences = _header_differences(
        before.semantic_header(), after.semantic_header()
    )
    if header_differences:
        raise RuntimeError(
            "linuxdeploy changed the canonical ELF header semantics: "
            f"{json.dumps(header_differences, sort_keys=True, separators=(',', ':'))}"
        )
    if before.identity() != after.identity():
        raise RuntimeError(
            "linuxdeploy changed the ELF identity or GNU build identity."
        )
    if before.runtime_paths == after.runtime_paths:
        raise RuntimeError(
            "linuxdeploy did not produce a distinct runtime-path transformation."
        )
    if before.runtime_paths:
        raise RuntimeError("Pre-bundle launcher must not contain an RPATH or RUNPATH.")
    if (
        len(after.runtime_paths) != 1
        or after.runtime_paths[0]["tag"] not in {"RPATH", "RUNPATH"}
        or after.runtime_paths[0]["value"] != EXPECTED_RUNTIME_PATH
    ):
        raise RuntimeError(
            f"Packaged launcher runtime path must be exactly {EXPECTED_RUNTIME_PATH}."
        )
    if _canonical_dynamic_entries(before.dynamic_entries) != _canonical_dynamic_entries(
        after.dynamic_entries
    ):
        raise RuntimeError("linuxdeploy changed a non-runtime-path dynamic entry.")

    before_sections = {section.name: section for section in before.sections}
    after_sections = {section.name: section for section in after.sections}
    if set(before_sections) != set(after_sections):
        raise RuntimeError("linuxdeploy changed the ELF section inventory.")
    dynamic = next(
        section for section in before.sections if section.type == SHT_DYNAMIC
    )
    linked_strings = before.sections[dynamic.link]
    after_dynamic = after_sections[dynamic.name]
    if (
        after_dynamic.type != SHT_DYNAMIC
        or after_dynamic.link >= len(after.sections)
        or after.sections[after_dynamic.link].name != linked_strings.name
    ):
        raise RuntimeError("linuxdeploy changed the dynamic-section string-table link.")
    allowed_section_names = {dynamic.name, linked_strings.name}
    after_linked_strings = after_sections[linked_strings.name]
    packaged_path_entries = [
        entry
        for entry in after.dynamic_entries
        if entry["tag"] in {DT_RPATH, DT_RUNPATH}
    ]
    if len(packaged_path_entries) != 1:
        raise RuntimeError(
            "Packaged launcher must contain exactly one runtime-path dynamic entry."
        )
    runtime_path_string = _attest_runtime_path_string(
        linked_strings,
        after_linked_strings,
        packaged_path_entries[0],
    )
    changed_sections = []
    for name, left in before_sections.items():
        right = after_sections[name]
        if name in allowed_section_names:
            left_record = before.semantic_section_record(left)
            right_record = after.semantic_section_record(right)
            fixed_fields = {
                "name",
                "type",
                "flags",
                "link_name",
                "info",
                "entry_size",
            }
            if any(left_record[field] != right_record[field] for field in fixed_fields):
                raise RuntimeError(
                    f"linuxdeploy changed unapproved metadata for runtime-linking section {name}."
                )
            if name == dynamic.name and left.alignment != right.alignment:
                raise RuntimeError("linuxdeploy changed .dynamic alignment.")
            if name == linked_strings.name and (
                right.alignment < left.alignment
                or right.alignment not in {left.alignment, 8}
                or right.alignment & (right.alignment - 1)
            ):
                raise RuntimeError(
                    "linuxdeploy changed .dynstr to an unapproved alignment."
                )
            if (
                left.data != right.data
                or left.address != right.address
                or left.offset != right.offset
                or left.size != right.size
                or left.alignment != right.alignment
                or left.index != right.index
            ):
                changed_sections.append(
                    {
                        "name": name,
                        "pre_index": left.index,
                        "packaged_index": right.index,
                        "pre_sha256": _sha256_bytes(left.data),
                        "packaged_sha256": _sha256_bytes(right.data),
                        "pre_address": left.address,
                        "packaged_address": right.address,
                        "pre_offset": left.offset,
                        "packaged_offset": right.offset,
                        "pre_size": left.size,
                        "packaged_size": right.size,
                        "pre_alignment": left.alignment,
                        "packaged_alignment": right.alignment,
                    }
                )
        elif before.semantic_section_record(left) != after.semantic_section_record(
            right
        ):
            raise RuntimeError(f"linuxdeploy changed stable ELF section {name}.")
    if {item["name"] for item in changed_sections} != allowed_section_names:
        raise RuntimeError(
            "linuxdeploy did not limit the transformation to .dynamic and its linked string table."
        )

    stable_before, stable_count = _stable_sections_digest(before, allowed_section_names)
    stable_after, stable_after_count = _stable_sections_digest(
        after, allowed_section_names
    )
    if stable_before != stable_after or stable_count != stable_after_count:
        raise RuntimeError("linuxdeploy changed the canonical stable-section digest.")

    before_programs = before.program_records()
    after_programs = after.program_records()
    header_transform = {
        "pre_bundle": before.header_transform(),
        "packaged": after.header_transform(),
    }
    changed_program_indices = _compare_program_headers(
        before_programs, after_programs, changed_sections, header_transform
    )
    before_allowed_dynamic = [
        entry
        for entry in before.dynamic_entries
        if entry["tag"] in ALLOWED_DYNAMIC_TAGS
    ]
    after_allowed_dynamic = [
        entry for entry in after.dynamic_entries if entry["tag"] in ALLOWED_DYNAMIC_TAGS
    ]
    before_string_size = next(
        entry["value"] for entry in before_allowed_dynamic if entry["tag"] == DT_STRSZ
    )
    after_string_size = next(
        entry["value"] for entry in after_allowed_dynamic if entry["tag"] == DT_STRSZ
    )
    changed_dynamic_tags = sorted(
        {
            DYNAMIC_TAG_NAMES[tag]
            for tag in ALLOWED_DYNAMIC_TAGS
            if [entry for entry in before_allowed_dynamic if entry["tag"] == tag]
            != [entry for entry in after_allowed_dynamic if entry["tag"] == tag]
        }
    )
    if not {"RPATH", "RUNPATH"}.intersection(changed_dynamic_tags):
        raise RuntimeError(
            "linuxdeploy receipt does not contain a runtime-path dynamic change."
        )
    for label, elf, strings in (
        ("pre-bundle", before, linked_strings),
        ("packaged", after, after_linked_strings),
    ):
        string_table_addresses = [
            entry["value"] for entry in elf.dynamic_entries if entry["tag"] == DT_STRTAB
        ]
        if string_table_addresses != [strings.address]:
            raise RuntimeError(
                f"{label} DT_STRTAB does not exactly identify the linked .dynstr section."
            )

    receipt = {
        "schema_version": 2,
        "target": LINUX_TARGET,
        "result": "passed",
        "transformation_kind": TRANSFORMATION_KIND,
        "pre_bundle": {
            "sha256": sha256_file(pre_bundle),
            "runtime_paths": before.runtime_paths,
        },
        "packaged": {
            "sha256": sha256_file(packaged),
            "runtime_paths": after.runtime_paths,
        },
        "elf_identity": before.identity(),
        "proof": {
            "elf_header": before.semantic_header(),
            "elf_header_transform": header_transform,
            "program_headers": {
                "pre_bundle": before_programs,
                "packaged": after_programs,
                "changed_indices": changed_program_indices,
            },
            "stable_sections": {
                "pre_bundle_sha256": stable_before,
                "packaged_sha256": stable_after,
                "count": stable_count,
            },
            "changed_sections": sorted(changed_sections, key=lambda item: item["name"]),
            "changed_dynamic_tags": changed_dynamic_tags,
            "dynamic_string_sizes": {
                "pre_bundle": before_string_size,
                "packaged": after_string_size,
            },
            "runtime_path_string": runtime_path_string,
        },
    }
    validate_receipt(receipt)
    return receipt


def _validate_runtime_paths(value: Any, label: str) -> list[dict[str, str]]:
    if not isinstance(value, list):
        raise TypeError(f"{label} runtime paths must be a list.")
    for item in value:
        item = _require_exact_fields(item, {"tag", "value"}, f"{label} runtime path")
        if item["tag"] not in {"RPATH", "RUNPATH"} or not isinstance(
            item["value"], str
        ):
            raise RuntimeError(f"{label} runtime path is invalid.")
    return value


def _validate_program_record(value: Any, label: str) -> dict[str, Any]:
    value = _require_exact_fields(value, PROGRAM_FIELDS, label)
    integer_fields = PROGRAM_FIELDS - {"type_name", "sections"}
    if any(
        not isinstance(value[field], int) or isinstance(value[field], bool)
        for field in integer_fields
    ):
        raise RuntimeError(f"{label} contains a non-integer ELF field.")
    expected_type_name = PROGRAM_TYPE_NAMES.get(value["type"], f"PT_{value['type']:#x}")
    if value["type_name"] != expected_type_name:
        raise RuntimeError(f"{label} has an invalid type name.")
    if (
        not isinstance(value["sections"], list)
        or any(not isinstance(name, str) for name in value["sections"])
        or len(value["sections"]) != len(set(value["sections"]))
    ):
        raise RuntimeError(f"{label} has an invalid section mapping.")
    if (
        value["type"] == PT_LOAD
        and value["alignment"] > 1
        and value["offset"] % value["alignment"]
        != value["virtual_address"] % value["alignment"]
    ):
        raise RuntimeError(f"{label} contains an incongruent PT_LOAD file mapping.")
    return value


def validate_receipt(receipt: Any) -> dict[str, Any]:
    receipt = _require_exact_fields(
        receipt, TOP_LEVEL_FIELDS, "launcher transformation"
    )
    if (
        receipt["schema_version"] != 2
        or receipt["target"] != LINUX_TARGET
        or receipt["result"] != "passed"
        or receipt["transformation_kind"] != TRANSFORMATION_KIND
    ):
        raise RuntimeError("Launcher transformation identity is invalid.")
    launchers = {}
    for label in ("pre_bundle", "packaged"):
        launcher = _require_exact_fields(receipt[label], LAUNCHER_FIELDS, label)
        if not isinstance(launcher["sha256"], str) or not SHA256.fullmatch(
            launcher["sha256"]
        ):
            raise RuntimeError(f"{label} launcher SHA-256 is invalid.")
        _validate_runtime_paths(launcher["runtime_paths"], label)
        launchers[label] = launcher
    if launchers["pre_bundle"]["sha256"] == launchers["packaged"]["sha256"]:
        raise RuntimeError(
            "Launcher transformation must attest distinct pre and packaged bytes."
        )
    if (
        launchers["pre_bundle"]["runtime_paths"]
        == launchers["packaged"]["runtime_paths"]
    ):
        raise RuntimeError("Launcher transformation runtime paths are unchanged.")
    if launchers["pre_bundle"]["runtime_paths"]:
        raise RuntimeError(
            "Pre-bundle launcher must not contain runtime-path evidence."
        )
    packaged_paths = launchers["packaged"]["runtime_paths"]
    if (
        len(packaged_paths) != 1
        or packaged_paths[0]["value"] != EXPECTED_RUNTIME_PATH
        or packaged_paths[0]["tag"] not in {"RPATH", "RUNPATH"}
    ):
        raise RuntimeError("Packaged launcher runtime-path evidence is invalid.")

    identity = _require_exact_fields(
        receipt["elf_identity"], IDENTITY_FIELDS, "ELF identity"
    )
    if (
        identity["class"] != "ELF64"
        or identity["byte_order"] != "little"
        or identity["machine"] != 62
        or not isinstance(identity["build_id"], str)
        or not identity["build_id"]
        or not all(
            character in "0123456789abcdef" for character in identity["build_id"]
        )
        or any(
            not isinstance(identity[field], int) or isinstance(identity[field], bool)
            for field in ("abi", "abi_version", "file_type", "entry_point", "flags")
        )
    ):
        raise RuntimeError("ELF identity evidence is invalid.")

    proof = _require_exact_fields(
        receipt["proof"], PROOF_FIELDS, "transformation proof"
    )
    header = proof["elf_header"]
    required_header_fields = {
        "class",
        "byte_order",
        "ident_version",
        "abi",
        "abi_version",
        "file_type",
        "machine",
        "version",
        "entry_point",
        "flags",
        "elf_header_size",
        "program_header_entry_size",
        "section_header_entry_size",
        "section_header_count",
    }
    header = _require_exact_fields(
        header, required_header_fields, "canonical ELF header"
    )
    if (
        header["class"] != identity["class"]
        or header["byte_order"] != identity["byte_order"]
        or header["abi"] != identity["abi"]
        or header["abi_version"] != identity["abi_version"]
        or header["file_type"] != identity["file_type"]
        or header["machine"] != identity["machine"]
        or header["entry_point"] != identity["entry_point"]
        or header["flags"] != identity["flags"]
        or any(
            not isinstance(header[field], int) or isinstance(header[field], bool)
            for field in required_header_fields - {"class", "byte_order"}
        )
    ):
        raise RuntimeError("Canonical ELF header is inconsistent with ELF identity.")

    header_transform = _require_exact_fields(
        proof["elf_header_transform"],
        {"pre_bundle", "packaged"},
        "ELF header transformation",
    )
    pre_header_transform = _require_exact_fields(
        header_transform["pre_bundle"],
        ELF_HEADER_TRANSFORM_FIELDS,
        "pre-bundle ELF header transformation",
    )
    packaged_header_transform = _require_exact_fields(
        header_transform["packaged"],
        ELF_HEADER_TRANSFORM_FIELDS,
        "packaged ELF header transformation",
    )
    if any(
        not isinstance(value, int) or isinstance(value, bool) or value < 0
        for transform in (pre_header_transform, packaged_header_transform)
        for value in transform.values()
    ):
        raise RuntimeError("ELF header transformation fields are invalid.")
    if (
        pre_header_transform["section_name_index"]
        != pre_header_transform["shstrtab_index"]
        or packaged_header_transform["section_name_index"]
        != packaged_header_transform["shstrtab_index"]
    ):
        raise RuntimeError(
            "ELF section-name index does not attest the .shstrtab section."
        )
    program_count_change = (
        packaged_header_transform["program_header_count"]
        - pre_header_transform["program_header_count"]
    )
    if program_count_change not in {0, 1}:
        raise RuntimeError(
            "ELF program-header count exceeds the one-segment relocation boundary."
        )
    if (
        program_count_change == 0
        and pre_header_transform["program_header_offset"]
        != packaged_header_transform["program_header_offset"]
    ):
        raise RuntimeError(
            "ELF program-header table moved without an added relocation segment."
        )

    programs = _require_exact_fields(
        proof["program_headers"], PROGRAM_PROOF_FIELDS, "program-header proof"
    )
    before_programs = (
        [
            _validate_program_record(item, f"pre-bundle program header {index}")
            for index, item in enumerate(programs["pre_bundle"])
        ]
        if isinstance(programs["pre_bundle"], list)
        else []
    )
    after_programs = (
        [
            _validate_program_record(item, f"packaged program header {index}")
            for index, item in enumerate(programs["packaged"])
        ]
        if isinstance(programs["packaged"], list)
        else []
    )
    if (
        not before_programs
        or not after_programs
        or len(before_programs) != pre_header_transform["program_header_count"]
        or len(after_programs) != packaged_header_transform["program_header_count"]
    ):
        raise RuntimeError("Program-header proof is incomplete.")
    if [item["index"] for item in before_programs] != list(
        range(len(before_programs))
    ) or [item["index"] for item in after_programs] != list(range(len(after_programs))):
        raise RuntimeError("Program-header indices are not canonical.")
    required_program_types = {PT_LOAD, PT_DYNAMIC, PT_PHDR, PT_GNU_STACK}
    if not required_program_types.issubset({item["type"] for item in before_programs}):
        raise RuntimeError(
            "Program-header proof omits a required load, dynamic, or stack segment."
        )
    changed_sections = proof["changed_sections"]
    if not isinstance(changed_sections, list):
        raise TypeError("Changed-section proof must be a list.")
    validated_sections = [
        _require_exact_fields(item, CHANGED_SECTION_FIELDS, "changed section")
        for item in changed_sections
    ]
    changed_names = {item["name"] for item in validated_sections}
    if changed_names != {".dynamic", ".dynstr"} or len(validated_sections) != 2:
        raise RuntimeError("Changed sections must be exactly .dynamic and .dynstr.")
    for section in validated_sections:
        integer_fields = CHANGED_SECTION_FIELDS - {
            "name",
            "pre_sha256",
            "packaged_sha256",
        }
        if (
            not isinstance(section["name"], str)
            or any(
                not isinstance(section[field], int)
                or isinstance(section[field], bool)
                or section[field] < 0
                for field in integer_fields
            )
            or section["pre_size"] <= 0
            or section["packaged_size"] <= 0
            or section["pre_alignment"] <= 0
            or section["packaged_alignment"] <= 0
            or section["pre_alignment"] & (section["pre_alignment"] - 1)
            or section["packaged_alignment"] & (section["packaged_alignment"] - 1)
            or any(
                not isinstance(section[field], str)
                or not SHA256.fullmatch(section[field])
                for field in ("pre_sha256", "packaged_sha256")
            )
            or section["pre_sha256"] == section["packaged_sha256"]
        ):
            raise RuntimeError("Changed-section proof is invalid.")

    expected_changed_indices = _compare_program_headers(
        before_programs,
        after_programs,
        validated_sections,
        {
            "pre_bundle": pre_header_transform,
            "packaged": packaged_header_transform,
        },
    )
    if (
        not isinstance(programs["changed_indices"], list)
        or programs["changed_indices"] != expected_changed_indices
        or any(
            not isinstance(index, int) or isinstance(index, bool)
            for index in programs["changed_indices"]
        )
    ):
        raise RuntimeError("Program-header changed-index proof is inconsistent.")
    stable_sections = _require_exact_fields(
        proof["stable_sections"], STABLE_SECTION_FIELDS, "stable-section proof"
    )
    if (
        any(
            not isinstance(stable_sections[field], str)
            or not SHA256.fullmatch(stable_sections[field])
            for field in ("pre_bundle_sha256", "packaged_sha256")
        )
        or stable_sections["pre_bundle_sha256"] != stable_sections["packaged_sha256"]
        or not isinstance(stable_sections["count"], int)
        or isinstance(stable_sections["count"], bool)
        or stable_sections["count"] < 1
    ):
        raise RuntimeError("Stable-section proof is invalid.")
    dynstr = next(
        section for section in validated_sections if section["name"] == ".dynstr"
    )
    string_size_changed = dynstr["pre_size"] != dynstr["packaged_size"]
    dynamic_string_sizes = _require_exact_fields(
        proof["dynamic_string_sizes"],
        DYNAMIC_STRING_SIZE_FIELDS,
        "dynamic string-table sizes",
    )
    if (
        dynamic_string_sizes["pre_bundle"] != dynstr["pre_size"]
        or dynamic_string_sizes["packaged"] != dynstr["packaged_size"]
        or any(
            not isinstance(dynamic_string_sizes[field], int)
            or isinstance(dynamic_string_sizes[field], bool)
            or dynamic_string_sizes[field] <= 0
            for field in ("pre_bundle", "packaged")
        )
    ):
        raise RuntimeError("Dynamic string-table size proof is invalid.")
    runtime_path_string = _require_exact_fields(
        proof["runtime_path_string"],
        RUNTIME_PATH_STRING_FIELDS,
        "runtime-path string proof",
    )
    expected_path_bytes = len(EXPECTED_RUNTIME_PATH.encode("utf-8")) + 1
    if (
        runtime_path_string["tag"] != packaged_paths[0]["tag"]
        or runtime_path_string["value"] != EXPECTED_RUNTIME_PATH
        or not isinstance(runtime_path_string["offset"], int)
        or isinstance(runtime_path_string["offset"], bool)
        or runtime_path_string["offset"] < 0
        or runtime_path_string["byte_length"] != expected_path_bytes
        or not isinstance(runtime_path_string["preserved_sha256"], str)
        or not SHA256.fullmatch(runtime_path_string["preserved_sha256"])
    ):
        raise RuntimeError("Runtime-path string proof is invalid.")
    if runtime_path_string["mode"] == "append":
        valid_string_boundary = (
            runtime_path_string["offset"] == dynstr["pre_size"]
            and dynstr["packaged_size"] == dynstr["pre_size"] + expected_path_bytes
        )
    elif runtime_path_string["mode"] == "zero-padding-replacement":
        valid_string_boundary = (
            dynstr["packaged_size"] == dynstr["pre_size"]
            and runtime_path_string["offset"] + expected_path_bytes
            <= dynstr["pre_size"]
        )
    else:
        valid_string_boundary = False
    if not valid_string_boundary:
        raise RuntimeError(
            "Runtime-path string proof exceeds the bounded .dynstr transformation."
        )
    expected_dynamic_tags = {
        tag
        for tag in ("RPATH", "RUNPATH")
        if [
            item["value"]
            for item in receipt["pre_bundle"]["runtime_paths"]
            if item["tag"] == tag
        ]
        != [
            item["value"]
            for item in receipt["packaged"]["runtime_paths"]
            if item["tag"] == tag
        ]
    }
    if string_size_changed:
        expected_dynamic_tags.add("STRSZ")
    if dynstr["pre_address"] != dynstr["packaged_address"]:
        expected_dynamic_tags.add("STRTAB")
    if (
        not isinstance(proof["changed_dynamic_tags"], list)
        or proof["changed_dynamic_tags"] != sorted(set(proof["changed_dynamic_tags"]))
        or set(proof["changed_dynamic_tags"]) != expected_dynamic_tags
    ):
        raise RuntimeError("Dynamic-tag transformation proof is invalid.")
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pre-bundle", type=Path, required=True)
    parser.add_argument("--packaged", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    receipt = create_receipt(
        arguments.pre_bundle.resolve(), arguments.packaged.resolve()
    )
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n", "utf-8"
    )
    print(f"Verified bounded linuxdeploy launcher transformation: {arguments.output}")


if __name__ == "__main__":
    main()
