"""Bounded rejected output, never a successful MusicXML export.

No selection, concatenation, inferred meter, or musical correction happens here.
The caller keeps the job failed and the successful result endpoint unavailable.
"""
from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path
from typing import Callable
from xml.etree import ElementTree as ET

from musicxml_output import normalize_audiveris_musicxml

MAX_RECOVERY_BYTES = 4_000_000
MAX_RECOVERY_DOCUMENTS = 32
RECOVERABLE_OUTPUT_CODES = frozenset({
    "AUDIVERIS_OUTPUT_INCOMPLETE", "AUDIVERIS_OUTPUT_AMBIGUOUS", "AUDIVERIS_OUTPUT_INVALID",
})


def rejected_output_bundle(
    output_dir: Path, *, code: str, engine_version: str,
    pages: list[dict], read_xml: Callable[[Path], str],
) -> str:
    if code not in RECOVERABLE_OUTPUT_CODES:
        raise ValueError("not a rejected output failure")
    paths = sorted(p for p in output_dir.rglob("*") if p.suffix.lower() in {".mxl", ".musicxml", ".xml"})
    if not paths or len(paths) > MAX_RECOVERY_DOCUMENTS:
        raise ValueError("rejected output inventory exceeds bounds or is empty")
    documents: list[dict] = []
    total = 0
    # Keep even identical serializations: these are opaque rejected artifacts,
    # not a claim about musical identity or consecutive movement order.
    for ordinal, path in enumerate(paths):
        if path.is_symlink() or not path.resolve().is_relative_to(output_dir.resolve()):
            raise ValueError("rejected output escaped workspace")
        if path.stat().st_size > MAX_RECOVERY_BYTES:
            raise ValueError("rejected output exceeds bounds")
        if path.suffix.lower() == ".mxl":
            with zipfile.ZipFile(path) as archive:
                entries = archive.infolist()
                if len(entries) > 64 or sum(e.file_size for e in entries) > MAX_RECOVERY_BYTES:
                    raise ValueError("rejected archive exceeds bounds")
        text = normalize_audiveris_musicxml(read_xml(path))
        raw = text.encode("utf-8")
        total += len(raw)
        if total > MAX_RECOVERY_BYTES:
            raise ValueError("rejected output exceeds bounds")
        root = ET.fromstring(text)
        if root.tag != "score-partwise":
            raise ValueError("rejected output has unsupported structure")
        documents.append({"id": f"fragment-{ordinal + 1}", "rawMusicXml": text,
                          "sha256": hashlib.sha256(raw).hexdigest()})
    result = {
        "version": "hm-omr-rejected-output-v1", "status": "incomplete", "code": code,
        "engineVersion": engine_version, "pages": pages, "documents": documents,
    }
    encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_RECOVERY_BYTES:
        raise ValueError("rejected output envelope exceeds bounds")
    return encoded
