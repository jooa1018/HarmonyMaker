"""Independent contract expectations; no private song data."""
import unittest,copy
from unittest.mock import patch
from xml.etree import ElementTree as E
from PIL import Image,ImageDraw
from score import observe
import lyric_recovery as lr

class LyricsContracts(unittest.TestCase):
    def test_cell_recovers_filtered_raw_symbol_and_is_idempotent(self):
        root,es,links,_=self.setup_notes();im=Image.new('L',(120,100),255);ImageDraw.Draw(im).rectangle((22,62,33,77),fill=0)
        s={'systemIndex':0,'spacing':8,'lines':[0,8,16,24,32],'bounds':[0,0,100,40]};row=[0,60,100,80]
        class Reader:
            def recognize(self,*args,**kwargs):return [{'text':'가','confidence':90,'box':[1,1,20,20]}]
        raw=[{'feature':'lyric-recovery','sourceBox':row,'transform':{'scale':1},'symbols':[{'text':'가','confidence':98,'box':[34,14,46,30]}]}for _ in range(2)]
        plans=[(s,[row],0,row,[])];changes=[];records=[]
        lr.recover_cells(im,plans,{(0,0):'1'},es,links,Reader(),raw,records,changes)
        self.assertEqual(es[0]['element'].findtext('lyric/text'),'가');count=len(changes)
        lr.recover_cells(im,plans,{(0,0):'1'},es,links,Reader(),raw,records,changes)
        self.assertEqual(len(changes),count)

    def test_cell_missing_column_clipped_ink_and_row_conflict_are_not_completed(self):
        for reason in ('column','clipping','row-conflict'):
            root,es,links,_=self.setup_notes();im=Image.new('L',(120,100),255)
            ImageDraw.Draw(im).rectangle((15 if reason=='clipping'else 22,62,33,77),fill=0)
            if reason=='column':links[es[0]['id']]['status']='unresolved'
            s={'systemIndex':0,'spacing':8,'lines':[0,8,16,24,32],'bounds':[0,0,100,40]};row=[0,60,100,80]
            class Reader:
                def recognize(self,*args,**kwargs):return [{'text':'가','confidence':90,'box':[1,1,20,20]}]
            raw=[{'feature':'lyric-recovery','sourceBox':row,'transform':{'scale':1},'symbols':[{'text':'나'if reason=='row-conflict'else '가','confidence':98,'box':[34,14,46,30]}]}for _ in range(2)]
            lr.recover_cells(im,[(s,[row],0,row,[])],{(0,0):'1'},es,links,Reader(),raw,[],[])
            self.assertIsNone(es[0]['element'].find('lyric'),reason)

    def test_raw_word_extension_suffix_needs_actual_line_ink(self):
        class Reader:
            def recognize(self,image,**kwargs):
                scale=(image.width-24)/200
                box=lambda b:[int(v*scale+12)for v in b]
                if kwargs.get('symbols'):return [{'text':text,'confidence':98,'box':box(b)}for text,b in [('G',[20,8,31,19]),('o',[33,8,43,19]),('_',[48,8,120,19])]]
                return [{'text':'Go___','confidence':5,'box':box([20,8,120,19])}]
        im=Image.new('L',(200,30),255);d=ImageDraw.Draw(im);d.rectangle((20,8,30,18),fill=0);d.rectangle((33,8,42,18),fill=0)
        self.assertTrue(all(not r for r in lr.read_row(im,[0,0,200,30],Reader(),'eng',[],0)))
        d.line((48,16,120,16),fill=0,width=1)
        self.assertTrue(all(r[0]['text']=='Go'for r in lr.read_row(im,[0,0,200,30],Reader(),'eng',[],0)))

    def test_wide_latin_word_requires_one_column_and_korean_dash_is_not_text(self):
        root,es,links,physical=self.setup_notes();s={'systemIndex':0,'spacing':8}
        u={'text':'word','sourceBox':[20,60,55,76]}
        self.assertEqual(lr.attach_units([copy.deepcopy(u)],s,links,physical,es)[0]['status'],'supported-candidate')
        other={**es[0],'id':'renamed-source-event','voice':'2'};es.append(other);links[other['id']]={'status':'physical-candidate','event':other,'geometry':{'center':[40,30]}}
        self.assertEqual(lr.attach_units([copy.deepcopy(u)],s,links,physical,es)[0]['status'],'unresolved')
        self.assertEqual(lr.attach_units([{'text':'고','sourceBox':[24,70,30,72]}],s,links,physical,es)[0]['reason'],'text box lacks full-height character ink')

    def test_word_box_attachment_cannot_replace_an_existing_automatic_word(self):
        root,es,links,physical=self.setup_notes();n=es[0]['element'];l=E.SubElement(n,'lyric',number='1');E.SubElement(l,'text').text='go'
        changes=[{'feature':'lyric','eventIds':[es[0]['id']],'after':E.tostring(l,encoding='unicode')}]
        s={'systemIndex':0,'spacing':8,'lines':[0,8,16,24,32],'bounds':[0,0,100,40]};im=Image.new('L',(120,100),255)
        units=[{'text':'eo','sourceBox':[20,60,55,76],'confidence':99},{'text':'word','sourceBox':[75,60,95,76],'confidence':99}]
        with patch.object(lr,'detect_rows',return_value=[[0,60,100,80]]),patch.object(lr,'read_row',return_value=[units,units,units]):
            lr.recover(im,[s],es,links,{'physicalIntervals':physical},None,[],changes)
        self.assertEqual(n.findtext('lyric/text'),'go');self.assertEqual(len(changes),1)

    def printed_fixture(self,second_pitch='G',verse='1',tie=False):
        root,es,links,_=self.setup_notes();m=root.find('part/measure');n=m.find('note')
        l=E.SubElement(n,'lyric',number=verse);E.SubElement(l,'text').text='가'
        other=copy.deepcopy(n);other.remove(other.find('lyric'));other.find('pitch/step').text=second_pitch;m.append(other)
        if tie:E.SubElement(n,'tie',type='start');E.SubElement(other,'tie',type='stop')
        _,es=observe(root);links={e['id']:{'status':'physical-candidate','event':{**{k:v for k,v in e.items()if k not in ('element','measure')}},'geometry':{'center':[27 if i==0 else 60,30]}}for i,e in enumerate(es)}
        s=[{'systemIndex':0,'spacing':8,'lines':[0,8,16,24,32],'bounds':[0,0,100,40]}]
        im=Image.new('L',(120,100),255);ImageDraw.Draw(im).rectangle((22,62,33,77),fill=0)
        change={'feature':'lyric','eventIds':[es[0]['id']],'after':E.tostring(l,encoding='unicode'),'sourceBox':[20,62,34,78]}
        return root,es,links,s,im,[change],l

    def test_printed_different_pitch_melisma_and_no_text_in_endpoint(self):
        root,es,links,s,im,changes,l=self.printed_fixture()
        ImageDraw.Draw(im).line((57,70,63,70),fill=0,width=2)
        with patch.object(lr,'detect_rows',return_value=[[0,60,100,80]]):
            lr.recover_printed_extensions(im,s,es,links,[],changes)
        self.assertIsNotNone(l.find('extend'));self.assertEqual(es[1]['element'].findtext('pitch/step'),'G')
        size=len(changes)
        with patch.object(lr,'detect_rows',return_value=[[0,60,100,80]]):lr.recover_printed_extensions(im,s,es,links,[],changes)
        self.assertEqual(len(changes),size)

    def test_tie_or_ocr_absence_alone_is_not_printed_extension(self):
        for opts in ({},{'second_pitch':'C','tie':True}):
            root,es,links,s,im,changes,l=self.printed_fixture(**opts)
            with patch.object(lr,'detect_rows',return_value=[[0,60,100,80]]):lr.recover_printed_extensions(im,s,es,links,[],changes)
            self.assertIsNone(l.find('extend'))

    def test_word_baseline_extension_is_distinct_from_midline_dash(self):
        root,es,links,s,im,changes,l=self.printed_fixture()
        ImageDraw.Draw(im).line((57,77,63,77),fill=0,width=1)
        with patch.object(lr,'detect_rows',return_value=[[0,60,100,80]]):lr.recover_printed_extensions(im,s,es,links,[],changes)
        self.assertIsNotNone(l.find('extend'))

    def test_unread_printed_syllable_new_attack_and_endpoint_conflicts_block(self):
        for failure in ('unread-ink','new-attack','missing-glyph','other-system','other-staff','other-verse-row'):
            root,es,links,s,im,changes,l=self.printed_fixture()
            d=ImageDraw.Draw(im);d.line((57,70,63,70),fill=0,width=2)
            if failure=='unread-ink':d.rectangle((64,64,66,77),fill=0)
            elif failure=='new-attack':E.SubElement(E.SubElement(es[1]['element'],'lyric',number='1'),'text').text='나'
            elif failure=='missing-glyph':links[es[1]['id']]['status']='unresolved'
            elif failure=='other-system':es[1]['systemIndex']=1
            elif failure=='other-staff':E.SubElement(es[1]['element'],'staff').text='2'
            elif failure=='other-verse-row':changes[0]['sourceBox']=[20,82,34,98]
            with patch.object(lr,'detect_rows',return_value=[[0,60,100,80]]):lr.recover_printed_extensions(im,s,es,links,[],changes)
            self.assertIsNone(l.find('extend'),failure)

    def test_each_verse_line_has_its_own_printed_endpoint(self):
        root,es,links,s,im,changes,l=self.printed_fixture()
        second=E.SubElement(es[0]['element'],'lyric',number='2');E.SubElement(second,'text').text='나'
        changes.append({'feature':'lyric-verse','eventIds':[es[0]['id']],'after':E.tostring(second,encoding='unicode'),'sourceBox':[20,82,34,98]})
        ImageDraw.Draw(im).line((57,70,63,70),fill=0,width=2)
        with patch.object(lr,'detect_rows',return_value=[[0,60,100,80],[0,80,100,100]]):lr.recover_printed_extensions(im,s,es,links,[],changes)
        self.assertIsNotNone(l.find('extend'));self.assertIsNone(second.find('extend'))

    def test_overlapping_symbol_uses_real_gap_not_equal_width(self):
        im=Image.new('L',(100,30),255);d=ImageDraw.Draw(im)
        d.rectangle((10,5,22,24),fill=0);d.rectangle((31,5,45,24),fill=0)
        symbols=[{'text':'가','box':[10,5,40,25],'confidence':98},{'text':'나','box':[31,5,46,25],'confidence':98}]
        fixed=lr.tighten_symbol_boxes(im,symbols)
        self.assertEqual(fixed[0]['box'],[10,5,23,25]);self.assertEqual(fixed[0]['text'],'가')
        d.rectangle((10,5,45,24),fill=0)
        self.assertEqual(lr.tighten_symbol_boxes(im,symbols)[0]['box'],symbols[0]['box'])

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
