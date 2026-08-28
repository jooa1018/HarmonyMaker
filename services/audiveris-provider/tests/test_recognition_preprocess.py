from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

from recognition_preprocess import MAX_PIXELS, MAX_SCALE, prepare_recognition_frame, preprocess_tiff_in_place


def test_blank_page_preserves_dimensions() -> None:
    source = Image.new("RGB", (1080, 1350), "white")
    prepared = prepare_recognition_frame(source)
    assert prepared.mode == "L"
    assert prepared.size == source.size


def test_margin_heavy_page_is_cropped_and_enlarged_without_distortion() -> None:
    source = Image.new("L", (1080, 1350), "white")
    draw = ImageDraw.Draw(source)
    draw.rectangle((260, 360, 820, 980), outline="black", width=3)
    draw.text((360, 420), "G   D   Em   C", fill="black")

    prepared = prepare_recognition_frame(source)

    assert prepared.width > 1080
    assert prepared.width <= round((820 - 260 + 2 * 24) * MAX_SCALE) + 8
    assert prepared.width * prepared.height <= MAX_PIXELS + prepared.width + prepared.height
    original_content_ratio = (820 - 260 + 2 * 24) / (980 - 360 + 2 * 24)
    prepared_ratio = prepared.width / prepared.height
    assert abs(prepared_ratio - original_content_ratio) < 0.02


def test_large_page_is_bounded_by_pixel_budget() -> None:
    source = Image.new("L", (3200, 4200), "white")
    draw = ImageDraw.Draw(source)
    draw.rectangle((20, 20, 3180, 4180), outline="black", width=4)
    prepared = prepare_recognition_frame(source)
    assert prepared.width * prepared.height <= MAX_PIXELS + prepared.width + prepared.height


def test_multiframe_tiff_keeps_page_count(tmp_path: Path) -> None:
    path = tmp_path / "score.tiff"
    first = Image.new("L", (800, 1000), "white")
    second = Image.new("L", (900, 1100), "white")
    ImageDraw.Draw(first).rectangle((120, 160, 680, 840), outline="black", width=3)
    ImageDraw.Draw(second).rectangle((140, 180, 760, 920), outline="black", width=3)
    first.save(path, format="TIFF", save_all=True, append_images=[second], compression="tiff_lzw")

    preprocess_tiff_in_place(path)

    with Image.open(path) as result:
        assert result.n_frames == 2
        result.seek(0)
        assert result.width > 800
        result.seek(1)
        assert result.width > 900
