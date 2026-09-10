"""Regression tests at the OCR-text boundary; these are not engine accuracy tests."""
from __future__ import annotations

from pathlib import Path
from xml.etree import ElementTree as ET

import pytest

import chord_ocr
from chord_ocr_model import (
    OcrHypothesis,
    preferred_spellings_from_fifths,
    resolve_hypothesis,
    spec_key,
    structural_key,
)
from test_chord_ocr import score_xml, synthetic_staff


@pytest.mark.parametrize("surface,canonical", [
    ("CΔ7", "Cmaj7"), ("CΔ9", "Cmaj9"), ("CΔ", "C"),
    ("C°7", "Cdim7"), ("C°", "Cdim"),
    ("Cø7", "Cm7b5"), ("Cø", "Cm7b5"),
    ("B♭Δ7/F", "Bbmaj7/F"), ("F♯ø7/A", "F#m7b5/A"),
])
def test_quality_symbols_preserve_source_chord_identity(surface: str, canonical: str) -> None:
    recognized = resolve_hypothesis(OcrHypothesis(surface, 95.0, "regression"))
    expected = resolve_hypothesis(OcrHypothesis(canonical, 95.0, "regression"))
    assert recognized is not None and expected is not None
    assert spec_key(recognized[0]) == spec_key(expected[0])


@pytest.mark.parametrize("text", ["C?7", "C𝄪7", "CΔ?7", "C°?7", "Cø?7", "CΔ6", "C/F♮"])
@pytest.mark.parametrize("allow_low_confidence", [False, True])
def test_unknown_symbols_do_not_become_a_plausible_chord(text: str, allow_low_confidence: bool) -> None:
    assert resolve_hypothesis(
        OcrHypothesis(text, 99.0, "regression"),
        preferred_spellings_from_fifths(1),
        allow_low_confidence=allow_low_confidence,
    ) is None


@pytest.mark.parametrize("fifths", [-7, -1, 0, 1, 7])
@pytest.mark.parametrize("surface,bass", [
    ("Dan02)/F", "F"), ("Dan02)/F3", "F#"), ("Dan02)/Fb", "Fb"),
])
def test_noisy_suffix_cannot_infer_an_unobserved_bass_accidental(fifths: int, surface: str, bass: str) -> None:
    result = resolve_hypothesis(
        OcrHypothesis(surface, 0.0, "regression"),
        preferred_spellings_from_fifths(fifths),
        allow_low_confidence=True,
    )
    assert result is not None
    assert result[0].root == "D"
    assert result[0].degrees == (("add", 2, 0),)
    assert result[0].bass == bass


def test_cross_hypothesis_support_keeps_bass_accidentals_distinct() -> None:
    natural = resolve_hypothesis(OcrHypothesis("Dadd2/F", 95.0, "regression"))
    sharp = resolve_hypothesis(OcrHypothesis("Dadd2/F#", 95.0, "regression"))
    assert natural is not None and sharp is not None
    assert structural_key(natural[0]) != structural_key(sharp[0])


@pytest.mark.parametrize("text,kind", [
    ("CΔ7", "major-seventh"), ("C°7", "diminished-seventh"),
    ("Cø7", "half-diminished"), ("C?7", None),
])
def test_augmentation_preserves_or_rejects_observed_quality(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, text: str, kind: str | None,
) -> None:
    # Only OCR is stubbed, deliberately: exercise real geometry, candidate selection,
    # XML injection and serialization without asserting Tesseract recognized a glyph.
    monkeypatch.setattr(chord_ocr, "ocr_chord_hypotheses", lambda *_args: [OcrHypothesis(text, 99.0, "regression")])
    image_path = tmp_path / "score.tiff"
    synthetic_staff().save(image_path, format="TIFF")
    original = score_xml()
    result, count = chord_ocr.augment_musicxml_with_chord_ocr(original, image_path, tmp_path / "work")
    if kind is None:
        assert count == 0
        assert result == original
    else:
        assert count == 2
        root = ET.fromstring(result)
        assert [node.text for node in root.iter("kind")] == [kind, kind]


def test_ocr_character_configuration_preserves_supported_quality_glyphs() -> None:
    # Configuration-boundary regression, not an engine recognition guarantee.
    from chord_ocr_image import WHITELIST
    assert set("♯♭Δ°ø").issubset(set(WHITELIST))
