"""MusicXML clock observation shared by local integration and its tests."""
from fractions import Fraction as F
from xml.etree import ElementTree as E

def observe(root):
    measures=[];events=[]
    for pi,p in enumerate(root.findall('part')):
        div=1;clef=('G',2);system=0;meter=None
        for mi,m in enumerate(p.findall('measure')):
            if mi and (m.find('print[@new-system="yes"]') is not None or m.find('print[@new-page="yes"]') is not None):system+=1
            cursor=F(0);last=F(0);local=[]
            for n in m:
                if n.tag=='attributes':
                    div=int(n.findtext('divisions',str(div)))
                    if n.find('clef') is not None:clef=(n.findtext('clef/sign'),int(n.findtext('clef/line','2')))
                    if n.find('time') is not None:meter=(n.findtext('time/beats'),n.findtext('time/beat-type'))
                elif n.tag in ['backup','forward']:cursor+=(1 if n.tag=='forward' else -1)*F(n.findtext('duration','0'))/div
                elif n.tag=='note':
                    onset=last if n.find('chord') is not None else cursor
                    dur=F(n.findtext('duration','0'))/div;pitch=n.find('pitch')
                    row={'id':f'd0p{pi}m{mi}n{len(local)}','partIndex':pi,'measureIndex':mi,'systemIndex':system,'noteIndex':len(local),'onset':str(onset),'duration':str(dur),'voice':n.findtext('voice','1'),'kind':'rhythm' if n.findtext('notehead')=='slash' else 'rest' if n.find('rest') is not None else 'note','step':pitch.findtext('step') if pitch is not None else None,'octave':int(pitch.findtext('octave')) if pitch is not None else None,'clef':clef,'hasCurve':n.find('tie') is not None or n.find('notations/slur') is not None,'element':n,'measure':m}
                    events.append(row);local.append(row)
                    if n.find('chord') is None:last=cursor;cursor+=dur
            measures.append({'id':f'p{pi}m{mi}','partIndex':pi,'measureIndex':mi,'systemIndex':system,'events':local,'element':m,'divisions':div,'meter':meter})
    return measures,events

def public(row):return {k:v for k,v in row.items() if k not in ['element','measure','events']}

def insert_at_time(m,node,onset):
    units=F(onset)*m['divisions']
    if units.denominator!=1:raise ValueError('Onset is not representable at existing divisions')
    if units:
        offset=E.Element('offset');offset.text=str(units.numerator)
        # MusicXML harmony places offset before staff. Harmony does not advance the clock.
        node.insert(next((i for i,n in enumerate(node) if n.tag=='staff'),len(node)),offset)
    at=next((i for i,n in enumerate(m['element']) if n.tag in ['note','backup','forward']),len(m['element']))
    m['element'].insert(at,node)

def add_candidate_notice(root):
    ident=root.find('identification')
    if ident is None:ident=E.SubElement(root,'identification')
    misc=ident.find('miscellaneous')
    if misc is None:misc=E.SubElement(ident,'miscellaneous')
    E.SubElement(misc,'miscellaneous-field',name='harmonymaker-local-candidate').text='Unverified automatic OMR integration candidate; review the companion evidence.json. Not Source-approved.'
