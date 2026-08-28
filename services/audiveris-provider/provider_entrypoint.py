from __future__ import annotations

import os
import sys
from pathlib import Path

import app as provider
from chord_ocr import augment_musicxml_with_chord_ocr
from musicxml_output import normalize_audiveris_musicxml

_PROVIDER_VERSION = "hm-audiveris-provider-v1.2"
_CHORD_OCR_ENABLED = os.environ.get("HM_AUDIVERIS_CHORD_OCR", "1").strip().lower() not in {
    "0", "false", "no", "off",
}
_original_decode_musicxml = provider.decode_musicxml


def _job_workspace(result_file: Path) -> Path:
    for parent in result_file.parents:
        if parent.name == "output":
            return parent.parent
    return result_file.parent


def _decode_musicxml(result_file: Path) -> str:
    musicxml = normalize_audiveris_musicxml(_original_decode_musicxml(result_file))
    if not _CHORD_OCR_ENABLED:
        return musicxml
    workspace = _job_workspace(result_file)
    try:
        augmented, count = augment_musicxml_with_chord_ocr(
            musicxml,
            workspace / "score.tiff",
            workspace / "chord-ocr",
        )
        if count:
            print(f"HarmonyMaker chord OCR inserted {count} unconfirmed harmony candidates", file=sys.stderr, flush=True)
        return augmented
    except Exception as error:  # The OMR result remains usable without chord suggestions.
        print(f"HarmonyMaker chord OCR fallback skipped: {type(error).__name__}", file=sys.stderr, flush=True)
        return musicxml


provider.decode_musicxml = _decode_musicxml
provider.PROVIDER_VERSION = _PROVIDER_VERSION
provider.app.version = _PROVIDER_VERSION

from demo_app import app  # noqa: E402,F401
