"""Conservative physical corroboration, never a reference-bar lookup."""
import numpy as np
from collections import Counter
from fractions import Fraction as F
from score import public

def bbox(poly):
    a=np.asarray(poly);return [float(a[:,0].min()),float(a[:,1].min()),float(a[:,0].max()),float(a[:,1].max())]

def pitch_position(event):
    sign,line=event['clef'];reference={'G':(4,'G'),'F':(3,'F'),'C':(4,'C')}.get(sign)
    if not reference or not event['step']:return None
    bottom=reference[0]*7+'CDEFGAB'.index(reference[1])-2*(line-1)
    return event['octave']*7+'CDEFGAB'.index(event['step'])-bottom+1

def build_links(measures,events,systems,provenance):
    traces={t['id']:t['trace'] for t in provenance};links={};regions=[];issues=[]
    for e in events:
        s=systems[e['systemIndex']];trace=traces.get(e['id']);row={'event':public(e),'status':'unresolved','evidence':[]}
        if trace is None:row['reason']='no exact token provenance';links[e['id']]=row;continue
        point=trace['fields'].get('coordinates')
        ts=[t for t in s['tokens'] if t['attentionCanvas'] is not None and point is not None and np.linalg.norm(np.array(point)-t['attentionCanvas'])<0.01]
        if len(ts)!=1:row['reason']='ambiguous attention token';links[e['id']]=row;continue
        xy=ts[0]['attentionOriginal'];row['attentionEstimate']=xy;row['token']=trace
        if xy is None:links[e['id']]=row;continue
        spacing=s['spacing'];position=pitch_position(e)
        candidates=[]
        for g in s['symbols']:
            if e['kind']=='note' and (g['type']!='Note' or position is None or abs(g.get('pixelStaffPosition',1e6)-position)>.45):continue
            if e['kind']=='rest' and g['type']!='Rest':continue
            dist=np.abs(np.array(g['center'])-xy)/spacing
            if dist[0]<=2.0:candidates.append((float(dist[0]),g))
        candidates.sort(key=lambda v:v[0])
        if candidates and (len(candidates)==1 or candidates[1][0]-candidates[0][0]>0.55):
            g=candidates[0][1];row.update(status='physical-candidate',geometry=g,sourceBox=bbox(g['polygon']),attentionVerticalDisagreementPixels=abs(g['center'][1]-xy[1]),evidence=['exact homr generator token trace','identical replayed source staff canvas','attention horizontal neighbourhood; attention vertical coordinate not trusted','source glyph center against local five-line geometry agrees with predicted diatonic pitch','unique pitch-and-column correspondence margin'])
        else:row['reason']='no unique physical glyph with agreeing pitch/position'
        links[e['id']]=row
    # One detected glyph cannot silently be reused by events at different musical times.
    uses={}
    for id,row in links.items():
        if row['status']=='physical-candidate':uses.setdefault(row['geometry']['id'],[]).append(id)
    for ids in uses.values():
        if len(ids)>1:
            for id in ids:links[id].update(status='unresolved',reason='duplicate geometric glyph assignment')
    for m in measures:
        s=systems[m['systemIndex']];spacing=s['spacing']
        # Boundaries are physical spanning barlines, not renderer widths.
        xs=sorted([s['bounds'][0],s['bounds'][2]]+[g['center'][0] for g in s['symbols'] if g['type']=='BarLine'])
        bounds=[]
        for x in xs:
            if bounds and x-bounds[-1]<0.8*spacing:bounds[-1]=(bounds[-1]+x)/2
            else:bounds.append(x)
        good=[links[e['id']] for e in m['events'] if links[e['id']]['status']=='physical-candidate']
        assignments=[next((i for i in range(len(bounds)-1) if bounds[i]<r['geometry']['center'][0]<bounds[i+1]),None) for r in good]
        region={'measure':public(m),'status':'unresolved','boundaries':bounds,'anchorEventIds':[r['event']['id'] for r in good]}
        unique=set(assignments)
        if len(unique)==1 and None not in unique and len(good)>=2:
            bi=next(iter(unique));left,right=bounds[bi:bi+2]
            # Corroborate the interval with the model's bar token, independently of bar count.
            bar_tokens=[t for t in s['tokens'] if 'barline' in t['fields']['rhythm'] or t['fields']['rhythm'].startswith('repeat')]
            near_right=[t for t in bar_tokens if t['attentionOriginal'] and abs(t['attentionOriginal'][0]-right)<=2.0*spacing]
            right_is_edge=abs(right-s['bounds'][2])<spacing
            if near_right or right_is_edge:
                region.update(status='physical-candidate',box=[left,s['bounds'][1],right,s['bounds'][3]],evidence=['two or more unique pitch-agreeing source glyph anchors','all anchors in one physical barline interval','right boundary corroborated by token or detected staff edge'])
        regions.append(region)
    # A pair of XML bars claiming the same source interval is a structural conflict.
    used={}
    for r in regions:
        if r['status']=='physical-candidate':used.setdefault((r['measure']['systemIndex'],tuple(r['box'])),[]).append(r)
    for values in used.values():
        if len(values)>1:
            for r in values:r.update(status='unresolved',reason='multiple XML measures claim one original interval')
    return links,regions

def locate_column(box,system_index,links,regions,kind='chord'):
    center=(box[0]+box[2])/2
    allowed=[r for r in regions if r['status']=='physical-candidate' and r['measure']['systemIndex']==system_index and r['box'][0]<center<r['box'][2]]
    if len(allowed)!=1:return {'status':'unresolved','reason':'no unique corroborated original measure interval','alternatives':[]}
    region=allowed[0];events=[]
    for id in region['anchorEventIds']:
        row=links[id];g=row['geometry'];spacing=(region['box'][3]-region['box'][1])/4
        delta=abs(g['center'][0]-center)
        # Text may be centered or left-anchored in different engravings. Both are recorded.
        left_delta=abs(g['center'][0]-box[0])
        distance=min(delta,left_delta)
        if distance<=1.35*spacing:events.append((distance,row))
    if not events:return {'status':'unresolved','reason':'no source glyph/text column overlap','alternatives':[]}
    groups={}
    for distance,row in events:groups.setdefault((row['event']['measureIndex'],row['event']['onset']),[]).append((distance,row))
    ranked=sorted(groups.items(),key=lambda item:min(v[0] for v in item[1]))
    if len(ranked)>1 and min(v[0] for v in ranked[1][1])-min(v[0] for v in ranked[0][1])<0.6*spacing:
        return {'status':'unresolved','reason':'text spans competing musical columns','alternatives':[list(k) for k in groups]}
    key,rows=ranked[0]
    return {'status':'supported-candidate','measureIndex':key[0],'onset':key[1],'eventIds':[r['event']['id'] for _,r in rows],'sourceMeasureBox':region['box'],'evidence':['source barline interval and event pitch glyph corroboration','text box column overlap','unique competing-onset margin'],'reviewRequired':True}
