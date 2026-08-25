from __future__ import annotations

import re

_DOCTYPE_START = re.compile(r"<!DOCTYPE\b")
_ENTITY_DECLARATION = re.compile(r"<!ENTITY\b")
_SCORE_ROOT = re.compile(r"<(?P<root>score-(?:partwise|timewise))\b")
_STANDARD_DOCTYPE = re.compile(
    r"""<!DOCTYPE[\t\n\r ]+
        (?P<root>score-(?:partwise|timewise))
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

_ALLOWED_PUBLIC_IDS = {
    "score-partwise": "-//Recordare//DTD MusicXML 4.0 Partwise//EN",
    "score-timewise": "-//Recordare//DTD MusicXML 4.0 Timewise//EN",
}
_ALLOWED_SYSTEM_IDS = {
    "score-partwise": frozenset(
        {
            "http://www.musicxml.org/dtds/partwise.dtd",
            "https://www.musicxml.org/dtds/partwise.dtd",
        }
    ),
    "score-timewise": frozenset(
        {
            "http://www.musicxml.org/dtds/timewise.dtd",
            "https://www.musicxml.org/dtds/timewise.dtd",
        }
    ),
}


def normalize_audiveris_musicxml(text: str) -> str:
    """Remove only Audiveris' allowlisted MusicXML 4.0 external DOCTYPE.

    HarmonyMaker's canonical importer intentionally rejects every DOCTYPE. Audiveris
    5.10.2 (proxymusic 4.0.3) emits the standard Recordare external declaration,
    which carries no score data and is unnecessary for parsing. This boundary strips
    only that exact declaration. Internal subsets, entity declarations, mismatched
    roots, unknown identifiers, and repeated declarations remain hard failures.
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

    declared_root = declaration.group("root")
    actual_root_name = actual_root.group("root")
    if declared_root != actual_root_name:
        raise RuntimeError("Audiveris MusicXML DOCTYPE root does not match the score root")
    if declaration.group("public_id") != _ALLOWED_PUBLIC_IDS[declared_root]:
        raise RuntimeError("Audiveris MusicXML contains an unsupported DOCTYPE public identifier")
    if declaration.group("system_id") not in _ALLOWED_SYSTEM_IDS[declared_root]:
        raise RuntimeError("Audiveris MusicXML contains an unsupported DOCTYPE system identifier")

    return text[:start] + text[declaration.end() :]
