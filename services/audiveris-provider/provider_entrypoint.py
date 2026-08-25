from __future__ import annotations

from pathlib import Path

import app as provider
from musicxml_output import normalize_audiveris_musicxml

_PROVIDER_VERSION = "hm-audiveris-provider-v1.1"
_original_decode_musicxml = provider.decode_musicxml


def _decode_musicxml(result_file: Path) -> str:
    return normalize_audiveris_musicxml(_original_decode_musicxml(result_file))


provider.decode_musicxml = _decode_musicxml
provider.PROVIDER_VERSION = _PROVIDER_VERSION
provider.app.version = _PROVIDER_VERSION

from demo_app import app  # noqa: E402,F401
