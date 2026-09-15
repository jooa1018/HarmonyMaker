"""Independent contract expectations; no private song data."""
import unittest,copy
from unittest.mock import patch
from xml.etree import ElementTree as E
from PIL import Image,ImageDraw
from score import observe
import lyric_recovery as lr

class LyricsContracts(unittest.TestCase):
    def test_crop_scale_roundtrip(self):
        self.assertEqual(lr.source_box([18,24,48,54],[100,200,300,230],3),[102,204,112,214])

    def test_no_text_completion_on_disagreement(self):
        def u(t):return {'text':t,'confidence':95,'sourceBox':[20,60,34,76]}
        self.assertIsNone(lr.elect_units([[u('가')],[u('나')]],8)[0]['text'])
        self.assertEqual(lr.elect_units([[u('가')],[u('가')]],8)[0]['text'],'가')

    def test_repeated_syllables_keep_distinct_pixels(self):
        a={'text':'가','confidence':95,'sourceBox':[20,60,34,76]};b={**a,'sourceBox':[50,60,64,76]}
        self.assertEqual(len(lr.elect_units([[a,b],[a,b]],8)),2)

    def test_staff_fragments_do_not_create_a_text_row(self):
        im=Image.new('L',(200,130),255);d=ImageDraw.Draw(im)
        d.line((20,65,180,65),fill=0,width=2)
        s={'spacing':8,'bounds':[0,0,200,40],'lines':[8,16,24,32,40]}
        self.assertEqual(lr.detect_rows(im,s),[])

    def test_two_actual_rows_remain_distinct(self):
        im=Image.new('L',(200,140),255);d=ImageDraw.Draw(im)
        for y in (65,90):
            for x in (25,60,95):d.rectangle((x,y,x+12,y+13),fill=0)
        s={'spacing':8,'bounds':[0,0,200,40],'lines':[8,16,24,32,40]}
        self.assertEqual(len(lr.detect_rows(im,s)),2)

    def setup_notes(self,rest=False,tie=False,voice='1'):
        a='<rest/>'if rest else '<pitch><step>C</step><octave>4</octave></pitch>'
        root=E.fromstring('<score-partwise><part><measure><attributes><divisions>1</divisions></attributes><note>'+a+'<duration>1</duration><voice>'+voice+'</voice>'+('<tie type="stop"/>'if tie else '')+'</note></measure></part></score-partwise>')
        _,events=observe(root);e=events[0]
        links={e['id']:{'status':'physical-candidate','event':{k:v for k,v in e.items()if k not in ('element','measure')},'geometry':{'center':[27,30]}}}
        physical={'p0m0':{'supported':True,'sourceBox':[0,0,100,50]}}
        return root,events,links,physical

    def test_unique_pitch_glyph_and_interval_required(self):
        _,es,links,physical=self.setup_notes();u={'text':'가','sourceBox':[20,60,34,76]};s={'spacing':8,'systemIndex':0}
        self.assertEqual(lr.attach_units([copy.deepcopy(u)],s,links,physical,es)[0]['status'],'supported-candidate')
        self.assertEqual(lr.attach_units([copy.deepcopy(u)],s,links,{},es)[0]['status'],'unresolved')
        links[es[0]['id']]['status']='unresolved'
        self.assertEqual(lr.attach_units([copy.deepcopy(u)],s,links,physical,es)[0]['status'],'unresolved')

    def test_rest_and_tie_continuation_rejected(self):
        for opts in ({'rest':True},{'tie':True}):
            _,es,links,physical=self.setup_notes(**opts)
            self.assertEqual(lr.attach_units([{'text':'가','sourceBox':[20,60,34,76]}],{'spacing':8,'systemIndex':0},links,physical,es)[0]['status'],'unresolved')

    def test_two_voices_at_same_column_are_unresolved(self):
        _,es,links,physical=self.setup_notes();second={**es[0],'id':'other','voice':'2'};es.append(second);links['other']={**links[es[0]['id']],'event':second}
        self.assertEqual(lr.attach_units([{'text':'가','sourceBox':[20,60,34,76]}],{'spacing':8,'systemIndex':0},links,physical,es)[0]['status'],'unresolved')

    def test_competing_tokens_are_not_zipped_to_notes(self):
        _,es,links,physical=self.setup_notes();units=[{'text':'가','sourceBox':[20,60,34,76]},{'text':'나','sourceBox':[21,60,35,76]}]
        self.assertTrue(all(u['status']=='unresolved'for u in lr.attach_units(units,{'spacing':8,'systemIndex':0},links,physical,es)))

    def test_printed_mark_and_paired_tie_both_required(self):
        root,es,links,physical=self.setup_notes();m=root.find('part/measure');n=m.find('note');E.SubElement(n,'tie',type='start')
        l=E.SubElement(n,'lyric',number='1');E.SubElement(l,'text').text='가'
        end=copy.deepcopy(n);end.remove(end.find('lyric'));end.find('tie').set('type','stop');m.append(end)
        _,es=observe(root);links[es[1]['id']]={'status':'physical-candidate','geometry':{'center':[60,30]}}
        record={'status':'preserved-existing','eventId':es[0]['id'],'text':'가','rowBox':[0,60,100,80],'sourceBox':[20,62,34,78]}
        changes=[{'feature':'lyric','eventIds':[es[0]['id']],'after':E.tostring(l,encoding='unicode')}]
        im=Image.new('L',(120,100),255);s=[{'systemIndex':0,'spacing':8}]
        lr.recover_extensions(im,s,es,links,[record],changes);self.assertIsNone(l.find('extend'))
        ImageDraw.Draw(im).line((40,70,47,70),fill=0,width=2)
        end.find('tie').set('type','start');lr.recover_extensions(im,s,es,links,[record],changes);self.assertIsNone(l.find('extend'))
        end.find('tie').set('type','stop');lr.recover_extensions(im,s,es,links,[record],changes);self.assertIsNotNone(l.find('extend'))
        count=len(changes);lr.recover_extensions(im,s,es,links,[record],changes);self.assertEqual(len(changes),count)

    def test_user_lyric_and_reapplication_are_preserved(self):
        root,es,links,physical=self.setup_notes();l=E.SubElement(es[0]['element'],'lyric',number='1');E.SubElement(l,'text').text='user'
        im=Image.new('L',(120,100),255);s={'systemIndex':0,'spacing':8,'lines':[0,8,16,24,32],'bounds':[0,0,100,40]}
        us=[{'text':'가','sourceBox':[20,60,34,76],'confidence':95},{'text':'나','sourceBox':[80,60,94,76],'confidence':95}]
        with patch.object(lr,'detect_rows',return_value=[[0,60,100,80]]),patch.object(lr,'read_row',return_value=[us,us,us]):
            changes=[];before=E.tostring(root);lr.recover(im,[s],es,links,{'physicalIntervals':physical},None,[],changes)
            self.assertEqual(E.tostring(root),before);self.assertEqual(changes,[])
            es[0]['element'].remove(l);lr.recover(im,[s],es,links,{'physicalIntervals':physical},None,[],changes)
            self.assertEqual(es[0]['element'].findtext('lyric/text'),'가');before=E.tostring(root);count=len(changes)
            lr.recover(im,[s],es,links,{'physicalIntervals':physical},None,[],changes)
            self.assertEqual(E.tostring(root),before);self.assertEqual(len(changes),count)

if __name__=='__main__':unittest.main()
