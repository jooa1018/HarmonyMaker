from __future__ import annotations

from pathlib import Path
from xml.etree import ElementTree as ET

from PIL import Image, ImageDraw

from chord_ocr import (
    ChordCandidate,
    OcrHypothesis,
    StaffGeometry,
    augment_musicxml_with_chord_ocr,
    detect_staffs,
    inject_candidates,
    parse_system_layouts,
    preferred_spellings_from_fifths,
    resolve_hypothesis,
)


def synthetic_staff() -> Image.Image:
    image = Image.new("L", (1000, 350), 255)
    draw = ImageDraw.Draw(image)
    for y in (200, 212, 224, 236, 248):
        draw.line((60, y, 940, y), fill=0, width=2)
    # Two text-like boxes in the chord band; segmentation should not need fonts.
    draw.rectangle((280, 130, 305, 162), outline=0, width=3)
    draw.rectangle((620, 130, 642, 162), outline=0, width=3)
    return image


def score_xml(*, existing_harmony: bool = False) -> str:
    harmony = "<harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>" if existing_harmony else ""
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1" width="440">
      <attributes><divisions>4</divisions><key><fifths>-1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      {harmony}<note default-x="220"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
    <measure number="2" width="440">
      <note default-x="220"><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>'''


def test_detects_one_staff_with_stable_span() -> None:
    staffs = detect_staffs(synthetic_staff())
    assert len(staffs) == 1
    assert staffs[0].lines == (200, 212, 224, 236, 248)
    assert staffs[0].left == 60
    assert staffs[0].right == 940


def test_resolves_noisy_parenthesized_add2_and_key_spelled_slash_bass() -> None:
    resolved = resolve_hypothesis(
        OcrHypothesis("Dan02)/F3", 0.0, "fixture"),
        preferred_spellings_from_fifths(1),
        allow_low_confidence=True,
    )
    assert resolved is not None
    harmony, _score = resolved
    assert harmony.root == "D"
    assert harmony.kind == "major"
    assert harmony.bass == "F#"
    assert harmony.degrees == (("add", 2, 0),)


def test_maps_candidates_to_measures_and_injects_structured_harmony() -> None:
    root = ET.fromstring(score_xml())
    systems = parse_system_layouts(root)
    assert len(systems) == 1
    staff = StaffGeometry(0, 200, (200, 212, 224, 236, 248), 12.0, 60, 940)
    c7 = resolve_hypothesis(OcrHypothesis("C7", 95.0, "fixture"), allow_low_confidence=True)
    f_major = resolve_hypothesis(OcrHypothesis("F", 95.0, "fixture"), allow_low_confidence=True)
    assert c7 is not None and f_major is not None
    candidates = [
        ChordCandidate(0, 0, 304, (280, 130, 328, 164), OcrHypothesis("C7", 95.0, "fixture"), c7[0], c7[1]),
        ChordCandidate(0, 0, 631, (620, 130, 643, 164), OcrHypothesis("F", 95.0, "fixture"), f_major[0], f_major[1]),
    ]
    assert inject_candidates(systems[0], staff, candidates) == 2
    harmonies = [element for element in root.iter() if element.tag.endswith("harmony")]
    assert len(harmonies) == 2
    kinds = [next(child for child in harmony if child.tag.endswith("kind")) for harmony in harmonies]
    assert [(kind.text, kind.attrib.get("text")) for kind in kinds] == [("dominant", "7"), ("major", None)]


def test_existing_harmony_disables_supplementation(tmp_path: Path) -> None:
    image_path = tmp_path / "score.tiff"
    synthetic_staff().save(image_path, format="TIFF")
    original = score_xml(existing_harmony=True)
    result, count = augment_musicxml_with_chord_ocr(original, image_path, tmp_path / "work")
    assert count == 0
    assert result == original
