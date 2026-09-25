"""Independent synthetic contracts; real-image evidence remains opt-in/private."""
import unittest,sys,copy
from pathlib import Path
from xml.etree import ElementTree as E
from PIL import Image,ImageDraw
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'services/audiveris-provider'))
import chord_recovery as cr
from score import observe


def reads(text,confidence=90,family='intact-oem1'):
    return [{'text':text,'confidence':confidence,'source':family+'-psm'+str(p)} for p in (7,8)]


def score():
    root=E.fromstring('<score-partwise><part id="test"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><tie type="start"/><voice>1</voice><lyric><text>unchanged</text></lyric></note><note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><tie type="stop"/><voice>1</voice></note></measure></part></score-partwise>')
    return root,observe(root)[0]


def candidate(at='0',symbol='Bb',box=(100,10,120,30)):
    return {'status':'eligible-candidate','measureIndex':0,'onset':at,'_spec':cr.exact(symbol),
            'sourceBox':box,'association':{'eventIds':['test-event'],'evidence':['synthetic physical proof']}}


class ChordRecoveryContracts(unittest.TestCase):
    def test_close_staff_letter_survives_but_entering_stem_does_not(self):
        for scale in (1,2):
            image=Image.new('L',(400*scale,220*scale),255);d=ImageDraw.Draw(image)
            def line(points):d.line(tuple(round(v*scale) for v in points),fill=0,width=scale)
            for y in (80,90,100,110,120):line((10,y,390,y))
            # C-shaped printed ink, ending 0.4 spaces above the staff. Its
            # bottom crosses the old band; no OCR/expected chord is injected.
            line((150,64,150,76));line((150,64,158,64));line((150,76,158,76))
            # A stem and beam entering the same band must still be excluded.
            line((210,60,210,90));line((210,60,225,60))
            s={'spacing':10*scale,'lines':[y*scale for y in (80,90,100,110,120)],'bounds':[10*scale,80*scale,390*scale,120*scale]}
            boxes=cr.boxes(image,s)
            self.assertTrue(any(b[0]<=150*scale and b[2]>=158*scale and b[1]<=64*scale and b[3]>=76*scale for b in boxes))
            self.assertFalse(any(b[0]<=210*scale<=b[2] for b in boxes))

    def test_exact_quality_and_bass_are_distinct(self):
        symbols=['C','Cm','C7','CM7','C#','Cb','C/F','C/F#','C/Bb','Csus2','Csus4','Cadd9']
        keys=[cr.cm.spec_key(cr.exact(s)) for s in symbols]
        self.assertEqual(len(set(keys)),len(symbols))
        for s in symbols:self.assertEqual(cr.elect(reads(s))[0],cr.exact(s))

    def test_lyrics_meter_number_and_noisy_lowercase_not_chords(self):
        for text in ['4/4','38','verse','Amen','8b','a','em','B-','E-','cCm7','BsM7']:
            with self.subTest(text=text):self.assertIsNone(cr.elect(reads(text))[0])

    def test_conflicting_minor_flat_and_seventh_remain_deferred(self):
        for a,b in [('Em','Eb'),('C7','CM7'),('Bb/D','B/D'),('C/F','C/G')]:
            self.assertIsNone(cr.elect(reads(a)+reads(b,family='intact-oem0'))[0])

    def test_low_confidence_slash_cannot_be_silently_discarded(self):
        self.assertIsNone(cr.elect(reads('Em')+reads('Eb/F',0,family='intact-oem0'))[0])

    def test_component_first_character_cannot_overrule_full_text(self):
        hs=reads('Dm')+[{'text':'D7','confidence':99,'source':'components'}]
        self.assertEqual(cr.elect(hs)[0].surface,'Dm')

    def test_duplicate_glyph_and_repeated_print_are_different(self):
        root,ms=score();self.assertEqual(cr.apply_candidates(ms,[candidate(),candidate()]),[])
        rows=[candidate(),candidate('2',box=(200,10,220,30))]
        self.assertEqual(len(cr.apply_candidates(ms,rows)),2)
        self.assertEqual(len(root.findall('.//harmony')),2)
        self.assertEqual([h.findtext('offset','0') for h in root.findall('.//harmony')],['0','8'])

    def test_reapplication_and_existing_conflict_preserve_music(self):
        root,ms=score();notes=[E.tostring(n)for n in root.findall('.//note')];attrs=E.tostring(root.find('.//attributes'))
        cr.apply_candidates(ms,[candidate('2')]);before=E.tostring(root)
        repeat=[candidate('2')];self.assertEqual(cr.apply_candidates(ms,repeat),[]);self.assertEqual(repeat[0]['status'],'preserved-existing')
        conflict=[candidate('2','Bm')];self.assertEqual(cr.apply_candidates(ms,conflict),[]);self.assertEqual(conflict[0]['status'],'unresolved')
        self.assertEqual(E.tostring(root),before);self.assertEqual(notes,[E.tostring(n)for n in root.findall('.//note')]);self.assertEqual(attrs,E.tostring(root.find('.//attributes')))

    def test_sustained_note_chord_offset_does_not_create_notes(self):
        root,ms=score();cr.apply_candidates(ms,[candidate('3/2','F')])
        self.assertEqual(root.findtext('.//harmony/offset'),'6');self.assertEqual(len(root.findall('.//note')),2)

    def test_file_name_and_event_ids_do_not_supply_chord_values(self):
        root,ms=score();a=candidate('2','Dm');b=copy.deepcopy(a);b['association']['eventIds']=['renamed-unrelated']
        other,oms=score();cr.apply_candidates(ms,[a]);cr.apply_candidates(oms,[b]);self.assertEqual(E.tostring(root),E.tostring(other))

    def test_ambiguous_column_is_deferred_under_coordinate_transform(self):
        for scale,shift in [(1,0),(2,50)]:
            sp=10*scale;system={'systemIndex':0,'spacing':sp}
            b=[shift,0,shift+100*scale,40*scale];r={'measure':{'id':'random','systemIndex':0},'status':'physical-candidate','box':b,'anchorEventIds':['a','b']}
            links={k:{'status':'physical-candidate','geometry':{'center':[shift+50*scale,10]},'event':{'measureIndex':0,'onset':at,'kind':'note'}}for k,at in [('a','0'),('b','1')]}
            result=cr.attach(candidate(),{'inkBox':[shift+45*scale,0,shift+55*scale,10]},system,links,[r],{},
                {'supported':True,'mode':'center','offsetSpaces':0},Image.new('L',(300,100),255))
            self.assertEqual(result['status'],'unresolved')

    def test_missing_rest_ink_does_not_become_a_chord_column(self):
        row={'event':{'kind':'rest'},'token':{'fields':{'rhythm':'rest_eighth'}},'attentionEstimate':[50,20]}
        s={'spacing':10,'lines':[0,10,20,30,40]}
        self.assertIsNone(cr.rest_column(Image.new('L',(100,50),255),row,s,{'supported':True,'eventIds':[]},{}))
        self.assertIsNone(cr.rest_column(Image.new('L',(100,50),0),row,s,{'supported':True,'eventIds':[]},{}))

    def test_below_staff_lyrics_and_inside_staff_meter_not_detected(self):
        image=Image.new('L',(400,220),255);d=ImageDraw.Draw(image)
        for y in (80,90,100,110,120):d.line((10,y,390,y),fill=0,width=1)
        d.text((150,145),'Am C7 F Dm',fill=0);d.text((40,92),'4/4',fill=0)
        s={'spacing':10,'lines':[80,90,100,110,120],'bounds':[10,80,390,120]}
        self.assertEqual(cr.boxes(image,s),[])


if __name__=='__main__':unittest.main(verbosity=2)
