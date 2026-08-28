from __future__ import annotations

from pathlib import Path
from xml.etree import ElementTree as ET

from chord_ocr_image import detect_staffs, load_frames, ocr_chord_hypotheses, segment_chord_boxes
from chord_ocr_model import (
    ChordCandidate,
    OcrHypothesis,
    StaffGeometry,
    clean_text,
    inject_candidates,
    local,
    max_staves,
    parse_system_layouts,
    preferred_spellings_from_fifths,
    resolve_hypothesis,
    spec_key,
    structural_key,
)

__all__ = [
    "ChordCandidate", "OcrHypothesis", "StaffGeometry", "augment_musicxml_with_chord_ocr",
    "detect_staffs", "inject_candidates", "parse_system_layouts",
    "preferred_spellings_from_fifths", "resolve_hypothesis", "segment_chord_boxes",
]


def first_fifths(root: ET.Element) -> int:
    for element in root.iter():
        if local(element.tag) == "fifths" and element.text:
            try: return max(-7, min(7, int(element.text.strip())))
            except ValueError: return 0
    return 0


def augment_musicxml_with_chord_ocr(musicxml: str, recognition_tiff: Path, work_dir: Path) -> tuple[str, int]:
    if "<harmony" in musicxml or not recognition_tiff.is_file():
        return musicxml, 0
    try: root = ET.fromstring(musicxml)
    except ET.ParseError: return musicxml, 0
    if local(root.tag) != "score-partwise" or max_staves(root) != 1:
        return musicxml, 0
    systems, frames = parse_system_layouts(root), load_frames(recognition_tiff)
    if not systems:
        return musicxml, 0
    try:
        staffs = [detect_staffs(frame, page) for page, frame in enumerate(frames)]
        by_page = {}
        for system in systems: by_page.setdefault(system.page_index, []).append(system)
        if set(by_page) != set(range(len(frames))) or any(len(layouts) != len(staffs[page]) for page, layouts in by_page.items()):
            return musicxml, 0
        preferred, inserted = preferred_spellings_from_fifths(first_fifths(root)), 0
        for page, layouts in by_page.items():
            for system_index, (layout, staff) in enumerate(zip(layouts, staffs[page], strict=True)):
                candidates = []
                for box_index, box in enumerate(segment_chord_boxes(frames[page], staff)):
                    hypotheses = ocr_chord_hypotheses(frames[page].crop(box), work_dir, f"p{page}-s{system_index}-b{box_index}")
                    permissive = [(item, result) for item in hypotheses if (result := resolve_hypothesis(item, preferred, allow_low_confidence=True))]
                    support, structural = {}, {}
                    for item in permissive:
                        support.setdefault(spec_key(item[1][0]), []).append(item)
                        structural.setdefault(structural_key(item[1][0]), set()).add(item[0].source)
                    resolved = [
                        item for items in support.values() for item in items
                        if item[0].confidence >= 20.0
                        or len({entry[0].source for entry in items}) >= 2
                        or len(structural[structural_key(item[1][0])]) >= 2
                        or (item[1][1] >= 0.72 and len(clean_text(item[0].text)) >= 7)
                    ]
                    if not resolved: continue
                    hypothesis, (harmony, score) = max(resolved, key=lambda item: (len(structural[structural_key(item[1][0])]), item[1][1] + 0.06 * len(support[spec_key(item[1][0])])) )
                    candidates.append(ChordCandidate(page, system_index, (box[0] + box[2]) / 2, box, hypothesis, harmony, score))
                inserted += inject_candidates(layout, staff, candidates)
        if not inserted: return musicxml, 0
        namespace = root.tag.split("}", 1)[0][1:] if root.tag.startswith("{") else ""
        if namespace: ET.register_namespace("", namespace)
        return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode", short_empty_elements=True), inserted
    finally:
        for frame in frames: frame.close()
