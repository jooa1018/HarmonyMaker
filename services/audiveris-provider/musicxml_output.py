from __future__ import annotations

import re

_DOCTYPE_START = re.compile(r"<!DOCTYPE\b")
_ENTITY_DECLARATION = re.compile(r"<!ENTITY\b")
_SCORE_ROOT = re.compile(r"<score-partwise\b")
_STANDARD_DOCTYPE = re.compile(
    r"""<!DOCTYPE[\t\n\r ]+
        score-partwise
        [\t\n\r ]+PUBLIC[\t\n\r ]+
        (?P<public_quote>[\"'])
        (?P<public_id>[^\"'\r\n]+)
        (?P=public_quote)
        [\t\n\r ]+
        (?P<system_quote>[\"'])
        (?P<system_id>[^\"'\r\n]+)
        (?P=system_quote)
        [\t\n\r ]*>
    """,
    re.VERBOSE,
)

# Audiveris 5.10.2 pins ProxyMusic 4.0.3. ProxyMusic builds this public
# identifier from its own artifact version, rather than from the MusicXML
# schema's shorter 4.0 version string.
_PINNED_PUBLIC_ID = "-//Recordare//DTD MusicXML 4.0.3 Partwise//EN"
_PINNED_SYSTEM_ID = "http://www.musicxml.org/dtds/partwise.dtd"


def normalize_audiveris_musicxml(text: str) -> str:
    """Remove only the external DOCTYPE emitted by pinned Audiveris 5.10.2.

    HarmonyMaker's canonical importer intentionally rejects every DOCTYPE. The
    pinned Audiveris/ProxyMusic pair emits one fixed Recordare declaration that
    carries no score data and is unnecessary for parsing. This boundary strips
    only that exact declaration. Internal subsets, entity declarations,
    mismatched roots, unknown identifiers, and repeated declarations remain
    hard failures.
    """

    if _ENTITY_DECLARATION.search(text):
        raise RuntimeError("Audiveris MusicXML contains an unsupported entity declaration")

    doctype_markers = list(_DOCTYPE_START.finditer(text))
    if not doctype_markers:
        return text
    if len(doctype_markers) != 1:
        raise RuntimeError("Audiveris MusicXML contains multiple DOCTYPE declarations")

    start = doctype_markers[0].start()
    declaration = _STANDARD_DOCTYPE.match(text, start)
    if declaration is None:
        raise RuntimeError("Audiveris MusicXML contains an unsupported DOCTYPE")

    prior_root = _SCORE_ROOT.search(text, 0, start)
    actual_root = _SCORE_ROOT.search(text, declaration.end())
    if prior_root is not None or actual_root is None:
        raise RuntimeError("Audiveris MusicXML DOCTYPE is outside the document prolog")
    if declaration.group("public_id") != _PINNED_PUBLIC_ID:
        raise RuntimeError("Audiveris MusicXML contains an unsupported DOCTYPE public identifier")
    if declaration.group("system_id") != _PINNED_SYSTEM_ID:
        raise RuntimeError("Audiveris MusicXML contains an unsupported DOCTYPE system identifier")

    return text[:start] + text[declaration.end() :]
