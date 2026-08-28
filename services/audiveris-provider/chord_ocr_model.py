from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Sequence
from xml.etree import ElementTree as ET

ROOTS = (
    "C", "C#", "Cb", "D", "D#", "Db", "E", "Eb", "F", "F#", "Fb",
    "G", "G#", "Gb", "A", "A#", "Ab", "B", "Bb",
)
ROOT_RE = re.compile(r"^(?P<root>[A-G](?:#|b)?)(?P<suffix>.*?)(?:/(?P<bass>[A-G](?:#|b)?))?$", re.I)
SUFFIXES = (
    ("", "major", None, ()), ("m", "minor", "m", ()),
    ("7", "dominant", "7", ()), ("maj7", "major-seventh", "maj7", ()),
    ("m7", "minor-seventh", "m7", ()), ("6", "major-sixth", "6", ()),
    ("m6", "minor-sixth", "m6", ()), ("9", "dominant-ninth", "9", ()),
    ("maj9", "major-ninth", "maj9", ()), ("m9", "minor-ninth", "m9", ()),
    ("dim", "diminished", "dim", ()), ("dim7", "diminished-seventh", "dim7", ()),
    ("aug", "augmented", "aug", ()), ("sus2", "suspended-second", "sus2", ()),
    ("sus4", "suspended-fourth", "sus4", ()), ("m7b5", "half-diminished", "m7b5", ()),
    ("add2", "major", "add2", (("add", 2, 0),)),
    ("(add2)", "major", "(add2)", (("add", 2, 0),)),
    ("add9", "major", "add9", (("add", 9, 0),)),
    ("(add9)", "major", "(add9)", (("add", 9, 0),)),
)
ALIASES = {
    "min": "m", "-": "m", "M7": "maj7", "ma7": "maj7", "major7": "maj7",
    "minor7": "m7", "o": "dim", "o7": "dim7", "+": "aug", "2": "add2",
    "(2)": "(add2)", "add02": "add2", "(add02)": "(add2)",
}


@dataclass(frozen=True)
class StaffGeometry:
    page_index: int
    top_line: int
    lines: tuple[int, int, int, int, int]
    spacing: float
    left: int
    right: int


@dataclass(frozen=True)
class HarmonySpec:
    surface: str
    root: str
    kind: str
    kind_text: str | None = None
    bass: str | None = None
    degrees: tuple[tuple[str, int, int], ...] = ()


@dataclass(frozen=True)
class OcrHypothesis:
    text: str
    confidence: float
    source: str


@dataclass(frozen=True)
class ChordCandidate:
    page_index: int
    system_index: int
    x_center: float
    box: tuple[int, int, int, int]
    hypothesis: OcrHypothesis
    harmony: HarmonySpec
    score: float


@dataclass
class MeasureLayout:
    element: ET.Element
    ordinal: int
    width: float
    anchors: list[tuple[float, int, ET.Element]]


@dataclass
class SystemLayout:
    page_index: int
    system_index: int
    measures: list[MeasureLayout]

    @property
    def width(self) -> float:
        return sum(measure.width for measure in self.measures)


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def children(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in list(element) if local(child.tag) == name]


def child(element: ET.Element, name: str) -> ET.Element | None:
    return next((item for item in list(element) if local(item.tag) == name), None)


def namespace(element: ET.Element) -> str:
    return element.tag.split("}", 1)[0] + "}" if element.tag.startswith("{") else ""


def sub(parent: ET.Element, name: str, value: str | None = None, **attrs: str) -> ET.Element:
    result = ET.SubElement(parent, f"{namespace(parent)}{name}", attrs)
    if value is not None:
        result.text = value
    return result


def clean_text(text: str) -> str:
    value = text.strip().replace("♯", "#").replace("♭", "b").replace("−", "-")
    value = value.replace("[", "(").replace("]", ")").replace("|", "/")
    value = re.sub(r"\s+", "", value)
    value = re.sub(r"[^A-Za-z0-9#b/()+.\-]", "", value)
    value = re.sub(r"(?<=/[A-Ga-g])[23]$", "#", value).strip("._,")
    return value[0].upper() + value[1:] if value and value[0].lower() in "abcdefg" else value


def _exact(text: str) -> HarmonySpec | None:
    match = ROOT_RE.match(clean_text(text))
    if not match:
        return None
    root_raw, bass_raw = match.group("root"), match.group("bass")
    root = root_raw[0].upper() + root_raw[1:]
    bass = bass_raw[0].upper() + bass_raw[1:] if bass_raw else None
    suffix = ALIASES.get(match.group("suffix"), match.group("suffix"))
    item = next((entry for entry in SUFFIXES if entry[0] == suffix), None)
    if root not in ROOTS or (bass and bass not in ROOTS) or item is None:
        return None
    surface, kind, kind_text, degrees = item
    return HarmonySpec(f"{root}{surface}{f'/{bass}' if bass else ''}", root, kind, kind_text, bass, degrees)


def _sub_cost(left: str, right: str) -> float:
    if left == right:
        return 0.0
    if left.lower() == right.lower():
        return 0.08
    if any(left in group and right in group for group in ("0oOdD", "1lI", "5sS", "2zZ", "3#", "c(", ")>}", "/1", "gGq", "b6")):
        return 0.38
    return 1.0


def weighted_distance(left: str, right: str) -> float:
    row = [float(index) for index in range(len(right) + 1)]
    for i, lchar in enumerate(left, 1):
        next_row = [float(i)] + [0.0] * len(right)
        for j, rchar in enumerate(right, 1):
            next_row[j] = min(row[j] + 1.0, next_row[j - 1] + 1.0, row[j - 1] + _sub_cost(lchar, rchar))
        row = next_row
    return row[-1]


def preferred_spellings_from_fifths(fifths: int) -> dict[str, str]:
    result = {step: step for step in "ABCDEFG"}
    order = "FCGDAEB" if fifths > 0 else "BEADGCF"
    accidental = "#" if fifths > 0 else "b"
    for step in order[: min(7, abs(fifths))]:
        result[step] = step + accidental
    return result


def _noisy(text: str, preferred: dict[str, str] | None) -> tuple[HarmonySpec, float] | None:
    match = re.match(r"^(?P<root>[A-G](?:#|b)?)(?P<body>.*?)/(?P<bass>[A-G])(?P<acc>[#b23]?)$", text, re.I)
    if not match:
        return None
    root_raw, body = match.group("root"), match.group("body").strip("()")
    root = root_raw[0].upper() + root_raw[1:]
    if len(body) < 2:
        return None
    bass_step, acc = match.group("bass").upper(), match.group("acc")
    acc = "#" if acc in ("2", "3") else acc
    if not acc and preferred:
        acc = preferred.get(bass_step, bass_step)[1:]
    normalized = body.lower().replace("o", "d").replace("0", "d")
    ranked = []
    for item in (entry for entry in SUFFIXES if entry[0]):
        target = item[0].strip("()").lower()
        distance = weighted_distance(normalized, target)
        visible, expected = {c for c in normalized if c.isdigit()}, {c for c in target if c.isdigit()}
        if visible and not visible.intersection(expected):
            distance += 1.5
        ranked.append((distance, item))
    distance, item = min(ranked, key=lambda value: (value[0], len(value[1][0]), value[1][0]))
    surface, kind, kind_text, degrees = item
    score = 1.0 - distance / max(len(normalized), len(surface.strip("()")), 1)
    if score < 0.52:
        return None
    bass = bass_step + acc
    return HarmonySpec(f"{root}{surface}/{bass}", root, kind, kind_text, bass, degrees), score


def _lexicon() -> list[HarmonySpec]:
    result = []
    for root in ROOTS:
        for suffix, kind, kind_text, degrees in SUFFIXES:
            result.append(HarmonySpec(root + suffix, root, kind, kind_text, None, degrees))
            result.extend(HarmonySpec(f"{root}{suffix}/{bass}", root, kind, kind_text, bass, degrees) for bass in ROOTS)
    return result


LEXICON = _lexicon()


def spec_key(spec: HarmonySpec) -> tuple[object, ...]:
    return spec.root, spec.kind, spec.bass, spec.degrees


def structural_key(spec: HarmonySpec) -> tuple[object, ...]:
    return spec.root, spec.kind, spec.bass[0] if spec.bass else None, spec.degrees


def resolve_hypothesis(
    hypothesis: OcrHypothesis,
    preferred: dict[str, str] | None = None,
    *,
    allow_low_confidence: bool = False,
) -> tuple[HarmonySpec, float] | None:
    text = clean_text(hypothesis.text)
    exact = _exact(text)
    if exact:
        minimum = 35.0 if len(text) <= 2 else 15.0
        return (exact, 1.0 + hypothesis.confidence / 200.0) if hypothesis.confidence >= minimum or allow_low_confidence else None
    if not text or text[0].upper() not in "ABCDEFG" or len(text) < 3:
        return None
    noisy = _noisy(text, preferred)
    if noisy and (hypothesis.confidence >= 20.0 or allow_low_confidence):
        return noisy[0], noisy[1] + hypothesis.confidence / 250.0
    root = text[0].upper() + (text[1] if len(text) > 1 and text[1] in "#b" else "")
    semantic: dict[tuple[object, ...], tuple[float, HarmonySpec]] = {}
    for item in (candidate for candidate in LEXICON if candidate.root == root):
        distance = weighted_distance(text, item.surface)
        if preferred and item.bass:
            expected = preferred.get(item.bass[0], item.bass[0])
            distance += -0.28 if item.bass == expected else 0.22 if len(item.bass) > 1 else 0.0
        key = spec_key(item)
        if key not in semantic or distance < semantic[key][0]:
            semantic[key] = distance, item
    ranked = sorted(semantic.values(), key=lambda value: (value[0], len(value[1].surface), value[1].surface))
    if not ranked:
        return None
    distance, best = ranked[0]
    second = ranked[1][0] if len(ranked) > 1 else math.inf
    normalized = distance / max(len(text), len(best.surface), 1)
    limit = 0.22 if max(len(text), len(best.surface)) <= 4 else 0.32
    if normalized > limit or second - distance < 0.32 or (hypothesis.confidence < 20.0 and not allow_low_confidence):
        return None
    return best, 1.0 - normalized + hypothesis.confidence / 250.0


def _float(value: str | None, default: float = 0.0) -> float:
    try:
        result = float(value) if value is not None else default
    except ValueError:
        return default
    return result if math.isfinite(result) else default


def parse_system_layouts(root: ET.Element) -> list[SystemLayout]:
    part = next((element for element in root.iter() if local(element.tag) == "part"), None)
    if part is None:
        return []
    systems: list[SystemLayout] = []
    current = None
    page = system = 0
    for ordinal, measure in enumerate(children(part, "measure")):
        print_element = child(measure, "print")
        new_page = print_element is not None and print_element.attrib.get("new-page") == "yes"
        new_system = print_element is not None and print_element.attrib.get("new-system") == "yes"
        if current is None or new_page or new_system:
            if current is not None:
                if new_page:
                    page, system = page + 1, 0
                else:
                    system += 1
            current = SystemLayout(page, system, [])
            systems.append(current)
        anchors = []
        for index, item in enumerate(list(measure)):
            if local(item.tag) == "note" and child(item, "chord") is None:
                x = _float(item.attrib.get("default-x"), -1.0)
                if x >= 0:
                    anchors.append((x, index, item))
        current.measures.append(MeasureLayout(measure, ordinal, _float(measure.attrib.get("width")), anchors))
    for layout in systems:
        positive = [measure.width for measure in layout.measures if measure.width > 0]
        fallback = sum(positive) / len(positive) if positive else 1.0
        for measure in layout.measures:
            if measure.width <= 0:
                measure.width = fallback
    return systems


def max_staves(root: ET.Element) -> int:
    result = 1
    for element in root.iter():
        if local(element.tag) == "staves" and element.text:
            try:
                result = max(result, int(element.text.strip()))
            except ValueError:
                return 99
    return result


def _pitch(parent: ET.Element, prefix: str, symbol: str) -> None:
    step, accidental = symbol[0], symbol[1:]
    sub(parent, f"{prefix}-step", step)
    if accidental:
        sub(parent, f"{prefix}-alter", "1" if accidental == "#" else "-1")


def harmony_element(parent: ET.Element, spec: HarmonySpec, default_x: float) -> ET.Element:
    harmony = ET.Element(f"{namespace(parent)}harmony", {"print-object": "yes", "default-x": f"{default_x:.3f}"})
    root = sub(harmony, "root")
    _pitch(root, "root", spec.root)
    sub(harmony, "kind", spec.kind, **({"text": spec.kind_text} if spec.kind_text else {}))
    if spec.bass:
        bass = sub(harmony, "bass")
        _pitch(bass, "bass", spec.bass)
    for degree_type, value, alter in spec.degrees:
        degree = sub(harmony, "degree")
        sub(degree, "degree-value", str(value)); sub(degree, "degree-alter", str(alter)); sub(degree, "degree-type", degree_type)
    sub(harmony, "staff", "1")
    return harmony


def inject_candidates(system: SystemLayout, staff: StaffGeometry, candidates: Sequence[ChordCandidate]) -> int:
    if not system.measures or system.width <= 0 or staff.right <= staff.left:
        return 0
    starts, running = [], 0.0
    for measure in system.measures:
        starts.append(running); running += measure.width
    selected: dict[tuple[int, int], tuple[ChordCandidate, float, MeasureLayout]] = {}
    for candidate in sorted(candidates, key=lambda value: value.x_center):
        ratio = (candidate.x_center - staff.left) / (staff.right - staff.left)
        if not -0.03 <= ratio <= 1.03:
            continue
        x = min(system.width, max(0.0, ratio * system.width))
        index = next((i for i, start in enumerate(starts) if x < start + system.measures[i].width), len(system.measures) - 1)
        measure, local_x = system.measures[index], x - starts[index]
        if not measure.anchors:
            continue
        anchor = min(measure.anchors, key=lambda value: abs(value[0] - local_x))
        if abs(anchor[0] - local_x) > max(60.0, measure.width * 0.42):
            continue
        key = measure.ordinal, anchor[1]
        if key not in selected or candidate.score > selected[key][0].score:
            selected[key] = candidate, local_x, measure
    grouped: dict[int, list[tuple[int, ChordCandidate, float, MeasureLayout]]] = {}
    for (_ordinal, child_index), (candidate, x, measure) in selected.items():
        grouped.setdefault(measure.ordinal, []).append((child_index, candidate, x, measure))
    inserted = 0
    for entries in grouped.values():
        for child_index, candidate, x, measure in sorted(entries, reverse=True, key=lambda value: value[0]):
            measure.element.insert(child_index, harmony_element(measure.element, candidate.harmony, x)); inserted += 1
    return inserted
