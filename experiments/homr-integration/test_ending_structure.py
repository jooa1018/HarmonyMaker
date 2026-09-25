"""Independent synthetic pixel and resolver contracts, not a private score oracle."""
import unittest,copy
from unittest.mock import patch
from xml.etree import ElementTree as E
from PIL import Image,ImageDraw
import numpy as np
import ending_structure as s
from score import observe

class EndingContracts(unittest.TestCase):

    def _accidental_bar(self,first_accidental):
        xml=("<score-partwise><part id='P1'><measure number='1'><attributes><divisions>1</divisions><key><fifths>-2</fifths></key>"
             "<time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>"
             "<note><pitch><step>E</step>"+("" if first_accidental else "<alter>-1</alter>")+"<octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>"
             +("<accidental>natural</accidental>" if first_accidental else "")+"</note>"
             "<note><pitch><step>E</step>"+("" if first_accidental else "<alter>-1</alter>")+"<octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type>"
             "<notations><ornaments><trill-mark/></ornaments></notations></note></measure></part></score-partwise>")
        root=E.fromstring(xml)
        im=Image.new('L',(400,180),255);d=ImageDraw.Draw(im)
        for y in (90,100,110,120,130):d.line((10,y,390,y),fill=110,width=1)
        for x in (120,200):d.ellipse((x-6,126,x+6,134),fill=30)
        sy={'systemIndex':0,'spacing':10,'lines':[90,100,110,120,130],'bounds':[10,90,390,130],'tokens':[],
            'symbols':[{'type':'Note','id':'h1','center':[120,130],'staffPosition':1},{'type':'Note','id':'h2','center':[200,130],'staffPosition':1}]}
        links={'d0p0m0n0':{'attentionEstimate':[120,130]},'d0p0m0n1':{'attentionEstimate':[200,130]}}
        cands=[{'feature':'chord','systemIndex':0,'sourceBox':[192,62,212,74],'hypotheses':[{'text':'Eb','confidence':90}]*3}]
        out=s.recover(root,im,[sy],links,[],[],cands,'synthetic')
        return root.findall('part/measure/note')[1],out

    def test_trill_collision_pitch_respects_in_measure_accidental(self):
        # Independent audit F-06: an earlier E-natural in the bar carries to the
        # next E4 head; the key-signature-only pitch would have made it Eb4.
        note,out=self._accidental_bar(True)
        self.assertEqual((note.findtext('pitch/step'),note.findtext('pitch/alter','0')),('E','0'))
        self.assertIsNotNone(note.find('notations/ornaments/trill-mark'))
        self.assertEqual([d['status'] for d in out['decisions']],['withheld-candidate'])
        self.assertIn('accidental',out['decisions'][0]['reason'])
        # Without accidental context the existing correction still applies.
        note,out=self._accidental_bar(False)
        self.assertEqual((note.findtext('pitch/step'),note.findtext('pitch/alter')),('E','-1'))
        self.assertIsNone(note.find('notations/ornaments/trill-mark'))
        self.assertEqual([d['status'] for d in out['decisions']],['applied-candidate'])
    def printed(self,kind='slash'):
        im=Image.new('L',(400,180),255);d=ImageDraw.Draw(im)
        for y in (90,100,110,120,130):d.line((10,y,390,y),fill=110,width=1)
        for x in (80,150,220,290):
            if kind=='slash':d.polygon([(x-8,92),(x+7,72),(x+10,74),(x-5,94)],fill=40)
            else:d.ellipse((x-7,79,x+7,87),fill=40)
            d.line((x-6,54,x-6,82),fill=120,width=1)
        d.rectangle((74,53,284,56),fill=40)
        sy={'systemIndex':0,'spacing':10,'lines':[90,100,110,120,130],'bounds':[10,90,390,130],'symbols':[],'tokens':[]}
        return im,sy

    def test_source_slashes_are_distinct_from_tilted_compact_heads(self):
        im,sy=self.printed();g=s.staff_grid(np.asarray(im),sy);found=s.slash_glyphs(np.asarray(im),sy,g)
        self.assertEqual(len(found),4);self.assertTrue(all(v.get('duration')=='1/2'for v in found))
        im,sy=self.printed('note');self.assertEqual(s.slash_glyphs(np.asarray(im),sy,s.staff_grid(np.asarray(im),sy)),[])

    def test_blank_pixels_cannot_supply_missing_rest_or_head(self):
        gray=np.full((100,100),255,dtype='uint8');token={'tokenIndex':7,'attentionOriginal':[40,40],'fields':{'rhythm':'rest_8','pitch':'_'},'text':'rest_8'}
        self.assertIsNone(s.source_rest(gray,token,10))
        sy={'symbols':[{'type':'Note','id':'other','center':[40,40]}]}
        self.assertEqual(s.open_heads(gray,sy,{'spacing':10}),[])
        self.assertEqual(s.dot_observation(gray,[98,90],10,40)['count'],0)

    def test_incomplete_stem_is_not_its_neighbours_beam(self):
        gray=np.full((100,100),255,dtype='uint8');gray[20:23,15:85]=0
        self.assertEqual(s.stem_and_beams(gray,[50,50],10)['status'],'unresolved')

    def test_same_pitch_without_raw_curve_does_not_create_tie(self):
        es=[{'id':str(i),'element':E.fromstring('<note/>')}for i in range(3)]
        gs=[{'center':[30+i*30,50]}for i in range(3)];links={str(i):{'attentionEstimate':g['center']}for i,g in enumerate(gs)}
        a=s.align_slashes(es,gs,[],links,10);self.assertEqual(a['modelCurveEdges'],[])
        es[0]['element'].append(E.Element('tie',type='start'));es[1]['element'].append(E.Element('tie',type='stop'))
        self.assertIsNone(s.align_slashes(es,gs,[],links,10))

    def test_ambiguous_missing_glyph_lineage_is_withheld(self):
        es=[{'id':str(i),'element':E.fromstring('<note/>')}for i in range(2)];gs=[{'center':[30+i*30,50]}for i in range(3)]
        self.assertIsNone(s.align_slashes(es,gs,[],{},10))

    def test_note_rewrite_preserves_lyrics_articulation_and_slur(self):
        n=E.fromstring('<note><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff><notations><slur type="start" number="3"/><articulations><accent/></articulations></notations><lyric number="2"><text>word</text></lyric></note>')
        result=s.make_note(n,'note','1/2','2',8,{'step':'A','octave':4,'alter':0})
        self.assertEqual(result.findtext('lyric/text'),'word');self.assertIsNotNone(result.find('notations/slur'));self.assertIsNotNone(result.find('notations/articulations/accent'))
        self.assertEqual(result.findtext('duration'),'4');self.assertEqual(n.findtext('voice'),'1')

    def test_divisions_and_arbitrary_measure_labels_preserve_voice_clock(self):
        for div in (4,16,120):
            root=E.fromstring(f'<score-partwise><part id="not-P1"><measure number="unrelated"><attributes><divisions>{div}</divisions></attributes></measure></part></score-partwise>');m=observe(root)[0][0]
            entries=[{'node':s.make_note(None,'rest','2','1',div),'onset':'0','duration':'2'},{'node':s.make_note(None,'rhythm','1/2','2',div),'onset':'0','duration':'1/2'},{'node':s.make_note(None,'rhythm','1/2','2',div),'onset':'1/2','duration':'1/2'}]
            s.rewrite_measure(m,entries);events=observe(root)[1];self.assertEqual([e['onset']for e in events],['0','0','1/2']);self.assertEqual([e['duration']for e in events],['2','1/2','1/2'])

    def test_plain_sequential_score_and_real_trill_are_untouched(self):
        root=E.fromstring('<score-partwise><part id="x"><measure number="z"><note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><notations><ornaments><trill-mark/></ornaments></notations></note></measure></part></score-partwise>')
        im,sy=self.printed('note');before=E.tostring(root)
        result=s.recover(root,im,[sy],{},[],[],[{'feature':'chord','systemIndex':0,'sourceBox':[20,20,40,40],'hypotheses':[{'text':'tr','confidence':99}]*3}],'unused-hash')
        self.assertEqual(result['changes'],[]);self.assertEqual(before,E.tostring(root))

    def test_idempotence_checks_exact_prior_result(self):
        root=E.fromstring('<score-partwise><part><measure number="x"/></part></score-partwise>');m=root.find('part/measure');history=[{'ruleVersion':s.VERSION,'measureId':'p0m0','after':E.tostring(m,encoding='unicode')}]
        self.assertEqual(s.recover(root,None,[],{},[],history,[],'unused')['additionalChanges'],0)
        m.set('implicit','yes')
        with self.assertRaises(ValueError):s.recover(root,None,[],{},[],history,[],'unused')

    def resolver_fixture(self):
        # Explicit observation fixture: tests role resolution, not glyph detection.
        root=E.fromstring('<score-partwise><part id="other"><measure number="different"><attributes><divisions>4</divisions></attributes><note><pitch><step>A</step><octave>5</octave></pitch><duration>12</duration><voice>2</voice><type>half</type><dot/><staff>1</staff><notations><slur type="stop" number="8"/></notations></note><note><pitch><step>C</step><octave>6</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><staff>1</staff></note><note><pitch><step>C</step><octave>6</octave></pitch><duration>2</duration><voice>1</voice><type>eighth</type><staff>1</staff></note></measure></part></score-partwise>')
        im,sy=self.printed();grid={'lines':sy['lines'],'spacing':10};gs=[{'id':f'independent-{i}','center':[x,82],'stem':{'stemX':x-10},'duration':'1/2','sourceBox':[x-8,72,x+8,94]}for i,x in enumerate([90,160,230])]
        h={'id':'independent-hollow','center':[80,90],'head':{'size':[20,12],'staffPosition':9},'sourceBox':[70,83,90,97]}
        links={f'd0p0m0n{i}':{'attentionEstimate':[x,90]}for i,x in enumerate([80,90,230])}
        return root,im,sy,grid,gs,h,links

    def test_independent_whole_and_neighbour_stem_use_two_clocks_without_meter_fitting(self):
        root,im,sy,grid,gs,h,links=self.resolver_fixture()
        with patch.object(s,'observe_structure',return_value=[{'systemIndex':0,'grid':grid,'slashes':gs}]),patch.object(s,'open_heads',return_value=[h]),patch.object(s,'arc_between',return_value=None):
            result=s.recover(root,im,[sy],links,[],[],[],'arbitrary-source')
        self.assertEqual(len(result['changes']),1);es=observe(root)[1]
        self.assertEqual(es[0]['duration'],'4');self.assertEqual(es[0]['voice'],'1');self.assertEqual(es[1]['kind'],'rhythm');self.assertEqual(es[1]['onset'],'0')
        self.assertEqual(es[2]['onset'],'1');self.assertEqual(es[3]['onset'],'1/2')
        self.assertIsNotNone(es[0]['element'].find('notations/slur')) # no paired source proof: retain slur
        self.assertEqual(max(s.F(e['onset'])+s.F(e['duration'])for e in es if e['voice']=='2'),s.F(3,2))

    def test_true_half_or_ambiguous_head_is_not_promoted_when_stem_missing(self):
        for size in ([11,12],[15,12]):
            root,im,sy,grid,gs,h,links=self.resolver_fixture();h['head']['size']=size;before=E.tostring(root)
            with patch.object(s,'observe_structure',return_value=[{'systemIndex':0,'grid':grid,'slashes':gs}]),patch.object(s,'open_heads',return_value=[h]):
                result=s.recover(root,im,[sy],links,[],[],[],'arbitrary-source')
            self.assertEqual(result['changes'],[]);self.assertEqual(E.tostring(root),before)

    def test_separate_lower_stem_and_dot_keep_dotted_half_not_whole(self):
        root,im,sy,grid,gs,h,links=self.resolver_fixture();h['center']=[80,136];h['head'].update(stemDirection='DOWN',staffPosition=0);h['sourceBox']=[70,130,90,143]
        d=ImageDraw.Draw(im);d.line((73,135,73,175),fill=0,width=1);d.ellipse((94,134,98,139),fill=0)
        with patch.object(s,'observe_structure',return_value=[{'systemIndex':0,'grid':grid,'slashes':gs}]),patch.object(s,'open_heads',return_value=[h]),patch.object(s,'arc_between',return_value=None):
            result=s.recover(root,im,[sy],links,[],[],[],'arbitrary-source')
        self.assertEqual(len(result['changes']),1);event=observe(root)[1][0]
        self.assertEqual(event['duration'],'3');self.assertEqual(event['step'],'D');self.assertEqual(event['octave'],4)

if __name__=='__main__':unittest.main()
