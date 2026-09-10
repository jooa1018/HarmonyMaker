"""Self-authored native/independent OCR integration regressions."""
from pathlib import Path
from types import SimpleNamespace
from xml.etree import ElementTree as ET

from PIL import Image, ImageDraw

import chord_ocr
import chord_ocr_image
from chord_ocr_model import OcrHypothesis, StaffGeometry


def test_chord_boxes_do_not_merge_with_stems_entering_from_staff():
    image=Image.new('L',(1000,350),255)
    draw=ImageDraw.Draw(image)
    for y in (200,212,224,236,248):draw.line((60,y,940,y),fill=0,width=2)
    draw.rectangle((280,140,302,162),outline=0,width=3)
    draw.rectangle((620,140,642,162),outline=0,width=3)
    # A beam and stems below the second text are connected to the staff, not
    # to the text. X-only segmentation used to join them into one OCR crop.
    draw.line((636,174,750,174),fill=0,width=5)
    draw.line((636,174,636,210),fill=0,width=3)
    draw.line((750,174,750,210),fill=0,width=3)
    staff=StaffGeometry(0,200,(200,212,224,236,248),12,60,940)
    original=image.tobytes()
    boxes=chord_ocr_image.segment_chord_boxes(image,staff)
    assert len(boxes)==2
    assert all(x1-x0<50 for x0,_y0,x1,_y1 in boxes)
    assert image.tobytes()==original


def test_partial_native_harmony_preserves_occupied_measure_and_fills_empty_measure(tmp_path, monkeypatch):
    original = '''<score-partwise version="4.0"><part-list/><part id="P1">
      <measure number="7" width="400"><attributes><divisions>4</divisions></attributes>
        <harmony><root><root-step>D</root-step></root><kind>minor</kind></harmony>
        <note default-x="200"><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration></note>
      </measure><measure number="8" width="400">
        <note default-x="200"><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration></note>
      </measure></part></score-partwise>'''
    image = tmp_path / "score.tiff"
    Image.new("L", (1000, 350), 255).save(image)
    staff = StaffGeometry(0, 200, (200,212,224,236,248), 12, 100, 900)
    monkeypatch.setattr(chord_ocr, "detect_staffs", lambda *_: [staff])
    monkeypatch.setattr(chord_ocr, "segment_chord_boxes", lambda *_: [(280,130,320,160),(680,130,720,160)])
    # First candidate conflicts with native Dm. It must not overwrite or duplicate it.
    monkeypatch.setattr(chord_ocr, "ocr_chord_hypotheses", lambda _image,_dir,stem: [OcrHypothesis("C7" if stem.endswith('b0') else "G",95,"fixture")])
    result, added = chord_ocr.augment_musicxml_with_chord_ocr(original,image,tmp_path/'ocr')
    assert added == 1
    before, after = ET.fromstring(original), ET.fromstring(result)
    before_measures, after_measures = before.findall('.//measure'), after.findall('.//measure')
    assert ET.tostring(after_measures[0]) == ET.tostring(before_measures[0])
    assert after_measures[1].findtext('harmony/root/root-step') == 'G'
    assert after_measures[1].findtext('harmony/kind') == 'major'
    assert [ET.tostring(n) for n in before.findall('.//note')] == [ET.tostring(n) for n in after.findall('.//note')]


def test_chord_ocr_uses_its_lstm_model_even_with_native_parent_prefix(tmp_path, monkeypatch):
    monkeypatch.setenv('TESSDATA_PREFIX','/native-legacy')
    monkeypatch.setenv('HM_AUDIVERIS_CHORD_TESSDATA','/chord-lstm')
    commands=[]
    def run(command, **_kwargs):
        commands.append(command)
        return SimpleNamespace(returncode=0,stdout='level\tpage\tblock\tpar\tline\tword\tx\ty\tw\th\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t20\t20\t95\tF\n')
    monkeypatch.setattr(chord_ocr_image.subprocess,'run',run)
    result=chord_ocr_image.tesseract_hypothesis(Image.new('L',(30,30),255),tmp_path,'test',7)
    assert result.text=='F'
    command=commands[0]
    assert command[command.index('--oem')+1]=='1'
    assert command[command.index('--tessdata-dir')+1]=='/chord-lstm'
    assert command[command.index('-l')+1]=='eng'
