from __future__ import annotations

import pytest

from musicxml_output import normalize_audiveris_musicxml

PARTWISE_PUBLIC_ID = "-//Recordare//DTD MusicXML 4.0 Partwise//EN"
PARTWISE_SYSTEM_ID = "http://www.musicxml.org/dtds/partwise.dtd"
TIMEWISE_PUBLIC_ID = "-//Recordare//DTD MusicXML 4.0 Timewise//EN"
TIMEWISE_SYSTEM_ID = "http://www.musicxml.org/dtds/timewise.dtd"


def score(root: str = "score-partwise") -> str:
    return f'<{root} version="4.0"></{root}>'


def doctype(root: str, public_id: str, system_id: str) -> str:
    return f'<!DOCTYPE {root} PUBLIC\n    "{public_id}"\n    "{system_id}">'


def test_leaves_doctype_free_musicxml_unchanged() -> None:
    original = '<?xml version="1.0" encoding="UTF-8"?>\n' + score()
    assert normalize_audiveris_musicxml(original) == original


@pytest.mark.parametrize(
    ("root", "public_id", "system_id"),
    [
        ("score-partwise", PARTWISE_PUBLIC_ID, PARTWISE_SYSTEM_ID),
        ("score-timewise", TIMEWISE_PUBLIC_ID, TIMEWISE_SYSTEM_ID),
        ("score-partwise", PARTWISE_PUBLIC_ID, "https://www.musicxml.org/dtds/partwise.dtd"),
    ],
)
def test_strips_only_allowlisted_musicxml_4_doctype(
    root: str,
    public_id: str,
    system_id: str,
) -> None:
    original = (
        '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
        f"{doctype(root, public_id, system_id)}\n"
        f"{score(root)}"
    )
    normalized = normalize_audiveris_musicxml(original)
    assert "<!DOCTYPE" not in normalized
    assert normalized.startswith('<?xml version="1.0"')
    assert score(root) in normalized


@pytest.mark.parametrize(
    "document",
    [
        (
            f'{doctype("score-partwise", "-//Recordare//DTD MusicXML 3.1 Partwise//EN", PARTWISE_SYSTEM_ID)}\n'
            f"{score()}"
        ),
        (
            f'{doctype("score-partwise", PARTWISE_PUBLIC_ID, "https://example.invalid/partwise.dtd")}\n'
            f"{score()}"
        ),
        (
            f'{doctype("score-timewise", TIMEWISE_PUBLIC_ID, TIMEWISE_SYSTEM_ID)}\n'
            f"{score()}"
        ),
        (
            '<!DOCTYPE score-partwise PUBLIC '
            f'"{PARTWISE_PUBLIC_ID}" "{PARTWISE_SYSTEM_ID}" '
            '[<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n'
            f"{score()}"
        ),
        (
            f'{doctype("score-partwise", PARTWISE_PUBLIC_ID, PARTWISE_SYSTEM_ID)}\n'
            f'{doctype("score-partwise", PARTWISE_PUBLIC_ID, PARTWISE_SYSTEM_ID)}\n'
            f"{score()}"
        ),
        (
            f"{score()}\n"
            f'{doctype("score-partwise", PARTWISE_PUBLIC_ID, PARTWISE_SYSTEM_ID)}'
        ),
        (
            '<!ENTITY xxe SYSTEM "file:///etc/passwd">\n'
            f"{score()}"
        ),
    ],
)
def test_rejects_non_allowlisted_or_active_doctype_markup(document: str) -> None:
    with pytest.raises(RuntimeError):
        normalize_audiveris_musicxml(document)
