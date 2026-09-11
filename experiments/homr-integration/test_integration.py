import unittest,sys
from pathlib import Path
from xml.etree import ElementTree as E
from fractions import Fraction as F
from score import observe,insert_at_time
from linking import locate_column,build_links

class CandidateTests(unittest.TestCase):
    def test_harmony_offset_order_keeps_absolute_onsets(self):
        root=E.fromstring('<score-partwise><part><measure><attributes><divisions>4</divisions></attributes><note><rest/><duration>16</duration></note></measure></part></score-partwise>')
        m,_=observe(root)
        for time in ['0','3/2','3']:
            h=E.Element('harmony');E.SubElement(h,'root');E.SubElement(h,'kind').text='major';E.SubElement(h,'staff').text='1';insert_at_time(m[0],h,time)
        hs=root.findall('.//harmony');self.assertEqual([h.findtext('offset','0') for h in hs],['0','6','12'])
        self.assertLess(list(hs[1]).index(hs[1].find('offset')),list(hs[1]).index(hs[1].find('staff')))
        self.assertEqual(observe(root)[1][0]['onset'],'0')
    def test_backup_chord_and_voice_clocks_are_retained(self):
        root=E.fromstring('<score-partwise><part><measure><attributes><divisions>4</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note><note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note><backup><duration>4</duration></backup><note><rest/><duration>8</duration><voice>2</voice></note></measure></part></score-partwise>')
        _,es=observe(root);self.assertEqual([e['onset'] for e in es],['0','0','0']);self.assertEqual([e['voice'] for e in es],['1','1','2'])
    def test_nearest_text_does_not_override_unverified_bar(self):
        regions=[{'status':'unresolved','measure':{'systemIndex':0},'box':[0,0,100,40]}]
        self.assertEqual(locate_column([20,0,25,5],0,{},regions)['status'],'unresolved')
    def test_competing_onsets_are_not_silently_rounded(self):
        links={str(i):{'geometry':{'center':[x,20]},'event':{'id':str(i),'measureIndex':0,'onset':str(i)}} for i,x in enumerate([40,45])}
        regions=[{'status':'physical-candidate','measure':{'systemIndex':0},'box':[0,0,100,40],'anchorEventIds':['0','1']}]
        self.assertEqual(locate_column([41,0,45,5],0,links,regions)['status'],'unresolved')
    def test_same_measure_count_is_not_geometric_correspondence(self):
        measures=[{'id':'p0m0','systemIndex':0,'events':[]}]
        systems=[{'spacing':10,'bounds':[0,0,100,40],'symbols':[],'tokens':[]}]
        _,regions=build_links(measures,[],systems,[]);self.assertEqual(regions[0]['status'],'unresolved')
    def test_existing_chord_parser_distinguishes_bass_and_quality(self):
        sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'services/audiveris-provider'))
        from chord_ocr_model import resolve_hypothesis,OcrHypothesis,spec_key
        a=resolve_hypothesis(OcrHypothesis('C/G',90,'test'))[0];b=resolve_hypothesis(OcrHypothesis('C',90,'test'))[0]
        self.assertEqual(a.bass,'G');self.assertNotEqual(spec_key(a),spec_key(b))

if __name__=='__main__':unittest.main()
