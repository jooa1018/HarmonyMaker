from __future__ import annotations

import math
import os
import sys
from pathlib import Path

from PIL import Image, ImageOps

WHITE_THRESHOLD = 245
TARGET_WIDTH = 1800
MAX_SCALE = 2.25
MAX_PIXELS = 5_000_000
MIN_PADDING_PX = 24
PADDING_RATIO = 0.03


def _foreground_bbox(gray: Image.Image) -> tuple[int, int, int, int] | None:
    mask = gray.point(lambda value: 255 if value < WHITE_THRESHOLD else 0)
    return mask.getbbox()


def _padded_bbox(
    bbox: tuple[int, int, int, int],
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    left, top, right, bottom = bbox
    content_width = max(1, right - left)
    content_height = max(1, bottom - top)
    pad_x = max(MIN_PADDING_PX, round(content_width * PADDING_RATIO))
    pad_y = max(MIN_PADDING_PX, round(content_height * PADDING_RATIO))
    return (
        max(0, left - pad_x),
        max(0, top - pad_y),
        min(width, right + pad_x),
        min(height, bottom + pad_y),
    )


def prepare_recognition_frame(image: Image.Image) -> Image.Image:
    """Return a bounded, aspect-preserving recognition copy of one page."""
    gray = ImageOps.grayscale(image)
    bbox = _foreground_bbox(gray)
    if bbox is None:
        return gray.copy()

    prepared = gray.crop(_padded_bbox(bbox, gray.width, gray.height))
    target_scale = TARGET_WIDTH / max(1, prepared.width)
    pixel_scale = math.sqrt(MAX_PIXELS / max(1, prepared.width * prepared.height))
    scale = min(MAX_SCALE, target_scale, pixel_scale)

    if scale < 0.995 or scale > 1.05:
        output_width = max(1, round(prepared.width * scale))
        output_height = max(1, round(prepared.height * scale))
        prepared = prepared.resize((output_width, output_height), Image.Resampling.LANCZOS)

    return ImageOps.autocontrast(prepared, cutoff=0.2)


def preprocess_tiff_in_place(path: Path) -> None:
    """Preprocess every TIFF frame atomically; original upload/evidence stays untouched."""
    temporary = path.with_name(f".{path.name}.recognition.tmp.tiff")
    frames: list[Image.Image] = []
    try:
        with Image.open(path) as source:
            frame_count = getattr(source, "n_frames", 1)
            for index in range(frame_count):
                source.seek(index)
                frames.append(prepare_recognition_frame(source.copy()))
        if not frames:
            raise RuntimeError("recognition input has no pages")
        frames[0].save(
            temporary,
            format="TIFF",
            save_all=True,
            append_images=frames[1:],
            compression="tiff_lzw",
        )
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink(missing_ok=True)
        for frame in frames:
            frame.close()


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: recognition_preprocess.py <score.tiff>", file=sys.stderr)
        return 2
    path = Path(argv[1])
    if not path.is_file():
        print(f"recognition input does not exist: {path}", file=sys.stderr)
        return 2
    preprocess_tiff_in_place(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
