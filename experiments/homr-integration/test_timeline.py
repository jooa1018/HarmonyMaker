"""Independent structural fixtures; none is evidence of image OCR accuracy."""
import unittest, copy
from xml.etree import ElementTree as E
from fractions import Fraction as F
from timeline import resolve, extent, VERSION, pickup_beam_pixels, detect_meters
from score import observe


def score(durations, systems=(), divisions=4):
    root = E.fromstring('<score-partwise><part id="independent"><measure number="0"/></part></score-partwise>')
    part=root.find('part');part.remove(part[0])
    for i, ds in enumerate(durations):
        m=E.SubElement(part,'measure',number=str(i+1))
        if i in systems:E.SubElement(m,'print',{'new-system':'yes'})
        a=E.SubElement(m,'attributes');E.SubElement(a,'divisions').text=str(divisions)
        if i==0:
            t=E.SubElement(a,'time');E.SubElement(t,'beats').text='4';E.SubElement(t,'beat-type').text='4'
        for j,d in enumerate(ds):
            n=E.SubElement(m,'note');p=E.SubElement(n,'pitch');E.SubElement(p,'step').text='E';E.SubElement(p,'octave').text='4'
            E.SubElement(n,'duration').text=str(int(F(d)*divisions));E.SubElement(n,'voice').text='1'
            if len(ds)>1:E.SubElement(n,'beam',number='1').text='begin' if j==0 else 'end' if j==len(ds)-1 else 'continue'
    return root


def proof(root):
    ms,_=observe(root)
    return {m['id']:{'supported':True,'firstInterval':m['measureIndex']==0 or m['systemIndex']!=ms[m['measureIndex']-1]['systemIndex'],
            'lastInterval':m['measureIndex']==len(ms)-1 or m['systemIndex']!=ms[m['measureIndex']+1]['systemIndex'],
            'headSpaces':2,'tailSpaces':2,'intervalWidthSpaces':30,'rhythmTokenCoverage':'exact',
            'layoutPrefixTokens':['clef_G2'] if m['measureIndex']==0 or m['systemIndex']!=ms[m['measureIndex']-1]['systemIndex'] else [],
            'rightBoundaryTokens':['barline'],'reason':'synthetic independent complete source coverage'}for m in ms}


BLANK={'verified':True,'blank':True,'reason':'synthetic verified blank edges'}


def meter(i, beats, den=4):
    return {'feature':'meter','ruleVersion':VERSION,'measureId':f'p0m{i}','status':'supported-candidate','value':[beats,den]}


def music(root):
    return [[E.tostring(n) for n in m if n.tag not in ('attributes','print')]for m in root.findall('part/measure')]


class TimelineFixtures(unittest.TestCase):
    def test_full_bar_unchanged(self):
        r=score([[1,1,1,1],[4]]);before=E.tostring(r);out=resolve(r,[],proof(r))
        self.assertEqual(before,E.tostring(r));self.assertEqual(out['changes'],[])

    def test_evidenced_initial_pickup_and_idempotence(self):
        r=score([[F(1,4),F(1,4)],[4]]);before=music(r);p=proof(r)
        out=resolve(r,[],p);self.assertEqual(len(out['changes']),1);self.assertEqual(r.find('part/measure').get('implicit'),'yes')
        first=E.tostring(r);again=resolve(r,[],p);self.assertEqual(E.tostring(r),first);self.assertEqual(again['changes'],[]);self.assertEqual(before,music(r))

    def test_missing_rest_or_note_does_not_shorten(self):
        for patch in [{'supported':False,'reason':'unmatched rest ink'},{'tailSpaces':12}]:
            r=score([[F(1,4),F(1,4)],[4]]);p=proof(r);p['p0m0'].update(patch)
            self.assertEqual(resolve(r,[],p)['changes'],[]);self.assertIsNone(r.find('part/measure').get('implicit'))
        r=score([[1,1],[4]])
        for n in r.findall('part/measure/note'):
            for b in n.findall('beam'):n.remove(b)
        self.assertEqual(resolve(r,[],proof(r))['changes'],[])

    def test_meter_changes_and_inheritance(self):
        r=score([[4],[2],[2],[4],[4]]);before=music(r)
        out=resolve(r,[meter(1,2),meter(3,4)],proof(r))
        self.assertEqual([m['meter']for m in observe(r)[0]],[('4','4'),('2','4'),('2','4'),('4','4'),('4','4')])
        self.assertEqual(len(out['changes']),2);self.assertEqual(before,music(r))

    def test_text_false_positive_duplicate_and_conflict(self):
        r=score([[4],[4]]);before=E.tostring(r)
        unresolved={**meter(1,2),'status':'unresolved','reason':'lyric lies outside staff'}
        self.assertEqual(resolve(r,[unresolved],proof(r))['changes'],[])
        self.assertEqual(resolve(r,[meter(1,2),meter(1,3)],proof(r))['changes'],[]);self.assertEqual(E.tostring(r),before)

    def test_system_connection_requires_more_than_complement(self):
        for tied, separate in [(False,False),(True,True),(True,False)]:
            r=score([[4],[3],[1],[4]],systems=(2,));ms=r.findall('part/measure')
            if tied:
                E.SubElement(ms[1].find('note'),'tie',type='start');E.SubElement(ms[2].find('note'),'tie',type='stop')
            if separate:E.SubElement(E.SubElement(ms[1],'barline'),'bar-style').text='light-heavy'
            before=music(r);out=resolve(r,[],proof(r))
            self.assertEqual(len(out['changes']),2 if tied and not separate else 0);self.assertEqual(before,music(r))
            if tied and not separate:self.assertEqual([ms[1].get('implicit'),ms[2].get('implicit')],['yes','yes'])

    def test_tie_free_system_partials_need_independent_compact_layout(self):
        r=score([[4],[3],[1],[4],[4],[4]],systems=(2,));p=proof(r);before=music(r)
        p['p0m1'].update(intervalWidthSpaces=23,headSpaces=2,tailSpaces=2,edgeInk=BLANK)
        p['p0m2'].update(intervalWidthSpaces=12,headSpaces=10,tailSpaces=2,layoutPrefixTokens=['clef_G2','keySignature_0'],edgeInk=BLANK)
        out=resolve(r,[],p);ms=r.findall('part/measure')
        self.assertEqual([ms[1].get('implicit'),ms[2].get('implicit')],['yes','yes'])
        self.assertEqual(len(out['changes']),2);self.assertEqual(before,music(r))
        self.assertTrue(all(c['evidence']['connectionMode']=='independent-compressed-layout' for c in out['changes']))

    def test_system_boundary_full_width_or_missing_token_is_not_shortened(self):
        for failure in ('full-width','missing-token'):
            r=score([[4],[3],[1],[4],[4],[4]],systems=(2,));p=proof(r);before=music(r)
            p['p0m1'].update(intervalWidthSpaces=23,headSpaces=2,tailSpaces=2)
            p['p0m2'].update(intervalWidthSpaces=12,headSpaces=10,tailSpaces=2,layoutPrefixTokens=['clef_G2'])
            if failure=='full-width':
                p['p0m1']['intervalWidthSpaces']=30;p['p0m2']['intervalWidthSpaces']=38
            else:p['p0m1']['rhythmTokenCoverage']='incomplete'
            self.assertEqual(resolve(r,[],p)['changes'],[]);self.assertEqual(before,music(r))

    def test_sparse_complete_bars_with_missed_rests_are_not_joined(self):
        # Audit counterexample (independent audit F-05): two complete 4/4 bars,
        # each a half note plus a half rest whose glyph and token the model
        # missed. Sparse bars are engraved narrow, so width alone matched.
        for label,edge in (('unverified',None),('rest ink in tail',{'verified':True,'blank':False}),('prefix unknown',{'verified':False,'blank':False})):
            r=score([[4],[2],[2],[4],[4],[4]],systems=(2,));p=proof(r);before=music(r)
            p['p0m1'].update(intervalWidthSpaces=18,headSpaces=2,tailSpaces=4)
            p['p0m2'].update(intervalWidthSpaces=16.5,headSpaces=10,tailSpaces=2,layoutPrefixTokens=['clef_G2'],edgeInk=BLANK)
            if edge is not None:p['p0m1']['edgeInk']=edge
            out=resolve(r,[],p)
            self.assertEqual(out['changes'],[],label);self.assertEqual(before,music(r))
            self.assertIsNone(r.findall('part/measure')[1].get('implicit'))
        # Same layout with pixel-verified blank edges is a genuine split bar.
        r=score([[4],[2],[2],[4],[4],[4]],systems=(2,));p=proof(r)
        p['p0m1'].update(intervalWidthSpaces=18,headSpaces=2,tailSpaces=4,edgeInk=BLANK)
        p['p0m2'].update(intervalWidthSpaces=16.5,headSpaces=10,tailSpaces=2,layoutPrefixTokens=['clef_G2'],edgeInk=BLANK)
        self.assertEqual(len(resolve(r,[],p)['changes']),2)

    def test_edge_ink_separates_rest_blob_from_continuing_curve(self):
        from PIL import Image,ImageDraw
        from timeline import edge_ink
        sp=10;lines=[40,50,60,70,80]
        def page(extra):
            im=Image.new('L',(300,120),255);d=ImageDraw.Draw(im)
            for y in lines:d.line((0,y,299,y),fill=0,width=1)
            d.ellipse((40,54,52,62),fill=0)  # the only recognized head, x=46
            extra(d);return im
        s={'spacing':sp,'lines':lines}
        blank=edge_ink(page(lambda d:None),s,10,290,[46],[],False)
        self.assertTrue(blank['verified'] and blank['blank'])
        curve=edge_ink(page(lambda d:d.arc((50,30,300,70),200,340,fill=0,width=2)),s,10,290,[46],[],False)
        self.assertTrue(curve['blank'],curve)
        rest=edge_ink(page(lambda d:d.rectangle((150,50,162,56),fill=0)),s,10,290,[46],[],False)
        self.assertFalse(rest['blank']);self.assertEqual(len(rest['regions']['tail']['blobs']),1)
        prefix=edge_ink(page(lambda d:d.rectangle((150,50,162,56),fill=0)),s,10,290,[200],[],True)
        self.assertFalse(prefix['verified'])

    def test_compact_but_noncomplementary_system_bars_stay_separate(self):
        r=score([[4],[2],[1],[4],[4],[4]],systems=(2,));p=proof(r);before=music(r)
        p['p0m1'].update(intervalWidthSpaces=15,headSpaces=2,tailSpaces=2)
        p['p0m2'].update(intervalWidthSpaces=12,headSpaces=10,tailSpaces=2,layoutPrefixTokens=['clef_G2'])
        self.assertEqual(resolve(r,[],p)['changes'],[]);self.assertEqual(before,music(r))

    def test_tie_does_not_override_a_separating_barline(self):
        r=score([[4],[3],[1],[4]],systems=(2,));ms=r.findall('part/measure');p=proof(r)
        E.SubElement(ms[1].find('note'),'tie',type='start');E.SubElement(ms[2].find('note'),'tie',type='stop')
        E.SubElement(E.SubElement(ms[1],'barline'),'repeat',direction='backward')
        self.assertEqual(resolve(r,[],p)['changes'],[])

    def test_polyphony_uses_extent_not_sum_or_first_voice(self):
        r=score([[1,1]]);m=r.find('part/measure');E.SubElement(E.SubElement(m,'backup'),'duration').text='8'
        n=copy.deepcopy(m.find('note'));n.find('voice').text='2';n.find('duration').text='16';m.append(n)
        self.assertEqual(extent(observe(r)[0][0]),F(4));self.assertEqual(resolve(r,[],proof(r))['changes'],[])

    def test_overfull_and_evidence_removed_hold(self):
        r=score([[3,3]]);before=music(r);out=resolve(r,[],proof(r));self.assertEqual(out['changes'],[])
        self.assertIn('overfull',out['decisions'][0]['reason']);self.assertEqual(before,music(r))
        r=score([[F(1,4),F(1,4)]]);self.assertEqual(resolve(r,[],{})['changes'],[])

    def test_divisions_name_number_invariance(self):
        outputs=[]
        for div in (4,16):
            r=score([[F(1,4),F(1,4)],[4]],divisions=div)
            r.find('part').set('id',f'changed-{div}')
            for i,m in enumerate(r.findall('part/measure')):m.set('number',f'unnumbered-{i*13}')
            resolve(r,[],proof(r));outputs.append([(m['element'].get('implicit'),str(extent(m)),m['meter'])for m in observe(r)[0]])
        self.assertEqual(*outputs)

    def test_source_beam_ink_and_broken_stem_are_distinct(self):
        from PIL import Image,ImageDraw
        r=score([[F(1,4),F(1,4)]]);m=observe(r)[0][0]
        s={'spacing':8};p={'supported':True}
        links={m['events'][i]['id']:{'geometry':{'center':[30+i*20,70]}}for i in range(2)}
        image=Image.new('L',(100,100),255);d=ImageDraw.Draw(image)
        for x in (30,50):d.ellipse((x-4,67,x+4,73),fill=0);d.line((x+3,40,x+3,70),fill=190,width=2)
        d.rectangle((33,40,54,44),fill=0)
        self.assertTrue(pickup_beam_pixels(image,m,s,links,p)['supported'])
        d.rectangle((51,48,54,60),fill=255)
        self.assertFalse(pickup_beam_pixels(image,m,s,links,p)['supported'])

    def test_text_without_model_time_token_is_not_a_meter(self):
        from PIL import Image,ImageDraw
        image=Image.new('L',(120,80),255);ImageDraw.Draw(image).text((20,20),'24',fill=0)
        s={'systemIndex':0,'spacing':8,'lines':[16,24,32,40,48],'bounds':[0,16,119,48],'symbols':[],'tokens':[]}
        self.assertEqual(detect_meters(image,[s],[],{},None),[])


if __name__=='__main__':unittest.main()
