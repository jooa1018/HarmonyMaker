from __future__ import annotations

import pytest

from musicxml_output import normalize_audiveris_musicxml

PINNED_PUBLIC_ID = "-//Recordare//DTD MusicXML 4.0.3 Partwise//EN"
PINNED_SYSTEM_ID = "http://www.musicxml.org/dtds/partwise.dtd"


def score() -> str:
    return '<score-partwise version="4.0"></score-partwise>'


def doctype(public_id: str, system_id: str) -> str:
    return f'<!DOCTYPE score-partwise PUBLIC\n    "{public_id}"\n    "{system_id}">'


def test_leaves_doctype_free_musicxml_unchanged() -> None:
    original = '<?xml version="1.0" encoding="UTF-8"?>\n' + score()
    assert normalize_audiveris_musicxml(original) == original


def test_strips_exact_doctype_emitted_by_pinned_audiveris() -> None:
    original = (
        '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
        f"{doctype(PINNED_PUBLIC_ID, PINNED_SYSTEM_ID)}\n"
        f"{score()}"
    )
    normalized = normalize_audiveris_musicxml(original)
    assert "<!DOCTYPE" not in normalized
    assert normalized.startswith('<?xml version="1.0"')
    assert score() in normalized


@pytest.mark.parametrize(
    "document",
    [
        f'{doctype("-//Recordare//DTD MusicXML 4.0 Partwise//EN", PINNED_SYSTEM_ID)}\n{score()}',
        f'{doctype("-//Recordare//DTD MusicXML 3.1 Partwise//EN", PINNED_SYSTEM_ID)}\n{score()}',
        f'{doctype(PINNED_PUBLIC_ID, "https://www.musicxml.org/dtds/partwise.dtd")}\n{score()}',
        f'{doctype(PINNED_PUBLIC_ID, "https://example.invalid/partwise.dtd")}\n{score()}',
        (
            '<!DOCTYPE score-partwise PUBLIC '
            f'"{PINNED_PUBLIC_ID}" "{PINNED_SYSTEM_ID}" '
            '[<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n'
            f"{score()}"
        ),
        (
            f'{doctype(PINNED_PUBLIC_ID, PINNED_SYSTEM_ID)}\n'
            f'{doctype(PINNED_PUBLIC_ID, PINNED_SYSTEM_ID)}\n'
            f"{score()}"
        ),
        f"{score()}\n{doctype(PINNED_PUBLIC_ID, PINNED_SYSTEM_ID)}",
        '<!ENTITY xxe SYSTEM "file:///etc/passwd">\n' + score(),
        (
            f'{doctype(PINNED_PUBLIC_ID, PINNED_SYSTEM_ID)}\n'
            '<score-timewise version="4.0"></score-timewise>'
        ),
    ],
)
def test_rejects_non_pinned_or_active_doctype_markup(document: str) -> None:
    with pytest.raises(RuntimeError):
        normalize_audiveris_musicxml(document)
