from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Sequence

from PIL import Image, ImageOps

from chord_ocr_model import OcrHypothesis, StaffGeometry, clean_text

WHITELIST = "ABCDEFGabcdefg#b0123456789/()+-majindomsuMN.C♯♭Δ°ø"


def otsu(gray: Image.Image) -> int:
    histogram, total = gray.histogram()[:256], gray.width * gray.height
    total_sum = sum(index * count for index, count in enumerate(histogram))
    weight = subtotal = 0
    best, threshold = -1.0, 180
    for value, count in enumerate(histogram):
        weight += count
        if not weight or weight == total:
            continue
        subtotal += value * count
        mean_a = subtotal / weight
        mean_b = (total_sum - subtotal) / (total - weight)
        variance = weight * (total - weight) * (mean_a - mean_b) ** 2
        if variance > best:
            best, threshold = variance, value
    return threshold


def mask(gray: Image.Image, threshold: int | None = None) -> Image.Image:
    threshold = threshold if threshold is not None else min(215, max(125, otsu(gray) + 24))
    return gray.point(lambda value: 255 if value < threshold else 0, "L")


def groups(values: Sequence[int], gap: int) -> list[list[int]]:
    result: list[list[int]] = []
    for value in values:
        if result and value - result[-1][-1] <= gap:
            result[-1].append(value)
        else:
            result.append([value])
    return result


def percentile(values: Sequence[float], ratio: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, min(len(ordered) - 1, round((len(ordered) - 1) * ratio)))] if ordered else 0.0


def longest_run(bits: Sequence[bool], gap_limit: int = 2) -> tuple[int, int] | None:
    best = start = last = None
    gap = 0
    for index, bit in enumerate(bits):
        if bit:
            start = index if start is None else start; last = index; gap = 0
        elif start is not None:
            gap += 1
            if gap > gap_limit:
                if best is None or last - start > best[1] - best[0]:
                    best = start, last
                start = last = None; gap = 0
    if start is not None and (best is None or last - start > best[1] - best[0]):
        best = start, last
    return best


def detect_staffs(frame: Image.Image, page_index: int = 0) -> list[StaffGeometry]:
    gray = ImageOps.autocontrast(ImageOps.grayscale(frame), cutoff=0.2)
    binary = mask(gray)
    projection = binary.resize((1, binary.height), Image.Resampling.BOX)
    density = [projection.getpixel((0, y)) / 255.0 for y in range(binary.height)]
    active = [y for y, value in enumerate(density) if value >= max(0.32, percentile(density, 0.985) * 0.68)]
    lines = [max(group, key=lambda y: density[y]) for group in groups(active, 2)]
    candidates = []
    for i, top in enumerate(lines):
        for j in range(i + 1, min(len(lines), i + 7)):
            spacing = lines[j] - top
            if spacing < 3 or spacing > max(90, binary.height // 8):
                continue
            chosen, cursor, error = [top, lines[j]], j + 1, 0.0
            for multiplier in (2, 3, 4):
                expected, tolerance = top + multiplier * spacing, max(2.0, spacing * 0.24)
                options = [(abs(lines[k] - expected), k, lines[k]) for k in range(cursor, min(len(lines), cursor + 8)) if abs(lines[k] - expected) <= tolerance]
                if not options:
                    break
                delta, cursor, line = min(options); cursor += 1; chosen.append(line); error += delta
            if len(chosen) == 5:
                candidates.append((sum(density[y] for y in chosen) / 5 - error / max(1.0, 20 * spacing), tuple(chosen), sum(chosen[k + 1] - chosen[k] for k in range(4)) / 4))
    result, used = [], set()
    for _score, five, spacing in sorted(candidates, reverse=True):
        if any(any(abs(line - prior) <= 2 for prior in used) for line in five):
            continue
        rows = [[any(binary.getpixel((x, yy)) for yy in range(max(0, y - 1), min(binary.height, y + 2))) for x in range(binary.width)] for y in five]
        run = longest_run([sum(row[x] for row in rows) >= 3 for x in range(binary.width)], 3)
        if run and run[1] - run[0] + 1 >= binary.width * 0.30:
            used.update(five); result.append(StaffGeometry(page_index, five[0], five, spacing, run[0], run[1]))
    return sorted(result, key=lambda item: item.top_line)


def segment_chord_boxes(frame: Image.Image, staff: StaffGeometry) -> list[tuple[int, int, int, int]]:
    spacing = staff.spacing
    top, bottom = max(0, round(staff.top_line - 4.9 * spacing)), max(1, round(staff.top_line - 1.05 * spacing))
    left, right = max(0, staff.left - round(0.5 * spacing)), min(frame.width, staff.right + round(0.5 * spacing))
    band = ImageOps.autocontrast(ImageOps.grayscale(frame.crop((left, top, right + 1, bottom))), cutoff=0.2)
    binary = mask(band, min(210, max(135, otsu(band) + 18)))
    active = [x for x in range(binary.width) if sum(binary.getpixel((x, y)) > 0 for y in range(binary.height)) >= max(1, round(binary.height * 0.035))]
    result = []
    for run in groups(active, max(2, round(0.82 * spacing))):
        crop = binary.crop((run[0], 0, run[-1] + 1, binary.height)); bbox = crop.getbbox()
        if not bbox:
            continue
        x0, y0, x1, y1 = bbox; width, height = x1 - x0, y1 - y0
        if width < max(2, 0.32 * spacing) or height < max(3, 0.72 * spacing) or width > 24 * spacing or height > 4.7 * spacing:
            continue
        dark = sum(value > 0 for value in crop.crop(bbox).getdata())
        if not 0.025 <= dark / max(1, width * height) <= 0.80:
            continue
        pad = max(2, round(0.35 * spacing))
        box = (max(0, left + run[0] + x0 - pad), max(0, top + y0 - pad), min(frame.width, left + run[0] + x1 + pad), min(frame.height, top + y1 + pad))
        if (box[0] + box[2]) / 2 >= staff.left + max(36.0, 5.0 * spacing):
            result.append(box)
    return result


def prepare(image: Image.Image, height: int = 160) -> Image.Image:
    gray = ImageOps.autocontrast(ImageOps.grayscale(image), cutoff=0.3)
    binary = mask(gray, min(215, max(135, otsu(gray) + 22))); pixels = gray.load()
    for y in range(gray.height):
        if sum(binary.getpixel((x, y)) > 0 for x in range(gray.width)) / max(1, gray.width) >= 0.78:
            for yy in range(max(0, y - 1), min(gray.height, y + 2)):
                for x in range(gray.width): pixels[x, yy] = 255
    bbox = mask(gray).getbbox(); gray = gray.crop(bbox) if bbox else gray
    scale = max(2.0, min(12.0, height / max(1, gray.height)))
    resized = gray.resize((max(1, round(gray.width * scale)), max(1, round(gray.height * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("L", (resized.width + 24, resized.height + 24), 255); canvas.paste(resized, (12, 12)); return canvas


def tesseract_hypothesis(image: Image.Image, directory: Path, stem: str, psm: int) -> OcrHypothesis | None:
    directory.mkdir(parents=True, exist_ok=True); path = directory / f"{stem}-psm{psm}.png"; prepare(image).save(path)
    command = ["tesseract", str(path), "stdout", "-l", "eng", "--psm", str(psm), "-c", f"tessedit_char_whitelist={WHITELIST}", "tsv"]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=12, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if completed.returncode:
        return None
    words, confidence = [], []
    for line in completed.stdout.splitlines()[1:]:
        fields = line.split("\t")
        if len(fields) >= 12 and fields[0] == "5" and fields[11].strip():
            words.append(fields[11].strip())
            try: confidence.append(max(0.0, float(fields[10])))
            except ValueError: confidence.append(0.0)
    return OcrHypothesis("".join(words), sum(confidence) / len(confidence), f"psm-{psm}") if words else None


def components(binary: Image.Image) -> list[tuple[int, int, int, int, int]]:
    width, height, pixels, visited, result = binary.width, binary.height, binary.load(), set(), []
    for y in range(height):
        for x in range(width):
            if not pixels[x, y] or (x, y) in visited: continue
            stack, area, x0, x1, y0, y1 = [(x, y)], 0, x, x, y, y; visited.add((x, y))
            while stack:
                cx, cy = stack.pop(); area += 1; x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < width and 0 <= ny < height and pixels[nx, ny] and (nx, ny) not in visited:
                            visited.add((nx, ny)); stack.append((nx, ny))
            result.append((x0, y0, x1 + 1, y1 + 1, area))
    return result


def glyph(image: Image.Image, directory: Path, stem: str) -> OcrHypothesis | None:
    for psm in (10, 13, 8):
        result = tesseract_hypothesis(image, directory, f"{stem}-glyph", psm)
        text = clean_text(result.text) if result else ""
        if text and text[0].upper() in "ABCDEFG": return OcrHypothesis(text[0].upper(), result.confidence, f"glyph-{psm}")
        if text and (text[0].isdigit() or text[0] in "#b/()"):
            return OcrHypothesis(text[0], result.confidence, f"glyph-{psm}")
    return None


def component_hypothesis(image: Image.Image, directory: Path, stem: str) -> OcrHypothesis | None:
    gray = ImageOps.autocontrast(ImageOps.grayscale(image), cutoff=0.2); binary = mask(gray)
    boxes = [list(item[:4]) for item in sorted((item for item in components(binary) if item[4] >= max(2, round(binary.width * binary.height * 0.004))), key=lambda item: item[0])]
    merged = []
    for box in boxes:
        if merged:
            prior = merged[-1]; overlap = min(prior[2], box[2]) - max(prior[0], box[0]); minimum = max(1, min(prior[2] - prior[0], box[2] - box[0]))
            if overlap / minimum >= 0.35:
                prior[:] = min(prior[0], box[0]), min(prior[1], box[1]), max(prior[2], box[2]), max(prior[3], box[3]); continue
        merged.append(box)
    if not 2 <= len(merged) <= 8: return None
    texts, confidences = [], []
    for index, (x0, y0, x1, y1) in enumerate(merged):
        result = glyph(gray.crop((max(0, x0 - 2), max(0, y0 - 2), min(gray.width, x1 + 2), min(gray.height, y1 + 2))), directory, f"{stem}-component-{index}")
        if not result: return None
        texts.append(result.text); confidences.append(result.confidence)
    return OcrHypothesis("".join(texts), sum(confidences) / len(confidences), "components")


def ocr_chord_hypotheses(image: Image.Image, directory: Path, stem: str) -> list[OcrHypothesis]:
    result = [item for item in (tesseract_hypothesis(image, directory, stem, 7), tesseract_hypothesis(image, directory, stem, 8), tesseract_hypothesis(image, directory, stem, 13)) if item]
    component = component_hypothesis(image, directory, stem)
    if component: result.append(component)
    return [item for item in result if clean_text(item.text)]


def load_frames(path: Path) -> list[Image.Image]:
    result = []
    with Image.open(path) as source:
        for index in range(getattr(source, "n_frames", 1)):
            source.seek(index); result.append(source.copy().convert("L"))
    return result
