"""Printed chord recovery: raster/OCR evidence only, never harmony inference.

All results remain review-required candidates. Text recognition, source-region
correspondence and musical onset are separate decisions. Calibration/templates
are derived afresh from the current raster, not a saved corrected score.
"""
from collections import defaultdict
from dataclasses import asdict
from statistics import median
import math
import numpy as np
from PIL import Image, ImageOps
import chord_ocr_image as ci
import chord_ocr_model as cm
from linking import locate_column

VERSION = 'hm-chord-recovery-v1.1'


def boxes(frame, system):
    """Staff-relative bands, including lettering close to the top staff line.

    Raising the search band handles text above stems/beams without expanding
    the lower edge into the staff. Shared lyric/meter preprocessing is untouched.
    """
    sp=system['spacing'];found=[]
    # The original lower edge (1.05 spaces above the staff) can cut through
    # ordinary chord letters. Boundary-connected ink is then correctly erased
    # as ambiguous, but the entire chord disappears. A second lower edge at
    # 0.25 spaces retains detached letters while still removing entering stems.
    # This is only region detection: OCR agreement and attachment remain gates.
    for shift in (0, 1.5, -0.8):
        staff=cm.StaffGeometry(0,round(system['lines'][0]-shift*sp),
            tuple(round(x-shift*sp) for x in system['lines']),sp,
            round(system['bounds'][0]),round(system['bounds'][2]))
        for box in ci.segment_chord_boxes(frame,staff):
            overlap=[i for i,b in enumerate(found) if min(box[2],b[2])>max(box[0],b[0])
                     and min(box[3],b[3])>max(box[1],b[1])]
            if not overlap:found.append(box)
            elif shift > 0:
                # A raised text box replaces a clipped/lower composite only
                # when its top was outside the old search band. Other overlap
                # remains one glyph, never a second printed chord.
                for i in overlap:
                    if box[1]<found[i][1]-sp*.5 and box[3]-box[1]<=3*sp:found[i]=box;break
            elif shift < 0:
                # Replace a clipped suffix only when the lower-band box fully
                # contains it. Never join merely overlapping distinct glyphs.
                contained=[i for i in overlap if box[0]<=found[i][0] and box[1]<=found[i][1]
                           and box[2]>=found[i][2] and box[3]>=found[i][3]]
                if len(contained)==len(overlap) and box[3]-box[1]<=4.7*sp:
                    found=[b for i,b in enumerate(found) if i not in contained];found.append(box)
    return sorted(set(found))


def read_plain(frame,box,ocr,raw):
    crop=ImageOps.autocontrast(frame.crop(box))
    # Preserve short horizontal letter strokes; no staff-line erasure here.
    prepared=ImageOps.expand(crop.resize((crop.width*6,crop.height*6),Image.Resampling.LANCZOS),24,255)
    reads=[]
    for oem,psm in ((0,7),(0,8),(1,7),(1,8)):
        words=ocr.recognize(prepared,oem=oem,psm=psm,whitelist=ci.WHITELIST)
        row={'feature':'chord','preparation':'intact-strokes-6x','sourceBox':box,'oem':oem,'psm':psm,'words':words}
        raw.append(row)
        reads.append({'text':''.join(w['text'] for w in words),
                      'confidence':min([w['confidence'] for w in words]+[0 if not words else 100]),
                      'source':f'intact-oem{oem}-psm{psm}'})
    return reads


def exact(text):
    # A short dash is easily the missing right strokes of a flat. The parser
    # still supports printed minor aliases; OCR cannot certify a dash here.
    if not text or text[0] not in 'ABCDEFGN' or '-' in text:return None
    return cm._exact(cm.clean_text(text))


def elect(reads):
    """Full-string evidence, never a first-character component vote.

    Correlated PSM reads form one preparation/engine family. A competing
    family remains explicit; two agreeing families can resolve one dissent.
    """
    votes=defaultdict(list);specs={}
    for h in reads:
        if h['source']=='components':continue
        spec=exact(h['text'])
        if not spec or h['confidence']<60:continue
        key=cm.spec_key(spec);specs[key]=spec;votes[key].append(h)
    supported={}
    for key,hs in votes.items():
        families=defaultdict(set)
        for h in hs:
            family=h['source'].rsplit('-psm',1)[0] if h['source'].startswith('intact-') else 'prepared-oem1'
            families[family].add(h['source'])
        strong=[f for f,v in families.items() if len(v)>=2]
        if strong:supported[key]=strong
    ranking=sorted(supported,key=lambda k:len(supported[k]),reverse=True)
    options=[{'symbol':specs[k].surface,'families':v} for k,v in supported.items()]
    if not ranking or (len(ranking)>1 and len(supported[ranking[0]])<=len(supported[ranking[1]])):
        return None,options
    winner=specs[ranking[0]]
    # A parseable slash alternative is a structural disagreement even when
    # its word confidence is low. Do not discard a printed bass just because
    # a correlated legacy pair confidently reads a shorter chord.
    slash_alternatives=[exact(h['text']) for h in reads if h['source']!='components']
    if winner.bass is None and len(supported[ranking[0]])==1 and any(s and s.bass is not None for s in slash_alternatives):
        return None,options
    return winner,options


def ink_shape(frame,box):
    mask=ci.mask(frame.crop(box));bb=mask.getbbox()
    if not bb:return None
    x,y,r,b=bb
    return {'array':np.asarray(mask.crop(bb).resize((64,32),Image.Resampling.BILINEAR),dtype=float)/255,
            'ratio':(r-x)/(b-y),'inkBox':[box[0]+x,box[1]+y,box[0]+r,box[1]+b]}


def templates(records,shapes):
    """Seed only agreeing intact full-string reads, not propagated guesses."""
    out=defaultdict(list)
    for i,r in enumerate(records):
        reads=[h for h in r['hypotheses'] if h['source'].startswith('intact-') and h['confidence']>=70]
        spec,options=elect(reads)
        if spec and len(options)==1 and shapes[i] is not None:out[cm.spec_key(spec)].append((i,spec))
    return out


def visual_read(index,shapes,seeds):
    a=shapes[index]
    if a is None:return None,[]
    ranked=[]
    for entries in seeds.values():
        values=[]
        for j,spec in entries:
            b=shapes[j]
            if j==index or abs(math.log(a['ratio']/b['ratio']))>.18:continue
            distance=float(np.abs(a['array']-b['array']).sum()/(a['array'].sum()+b['array'].sum()))
            values.append((distance,j,spec))
        if values:ranked.append(min(values,key=lambda v:v[0]))
    ranked.sort(key=lambda v:v[0])
    evidence=[{'symbol':s.surface,'distance':d,'seedCandidate':j} for d,j,s in ranked]
    margin=ranked[1][0]-ranked[0][0] if len(ranked)>1 else 1
    if ranked and ((ranked[0][0]<=.10 and margin>=.03) or (ranked[0][0]<=.12 and margin>=.08)):
        return ranked[0][2],evidence
    return None,evidence


def slash_read(frame,box,ocr,raw,shapes,seeds):
    """Split only at an observed isolated diagonal, then verify both texts.

    A slash-shaped stroke alone is not a chord. Root and bass each need OCR
    and/or same-raster full-glyph agreement; arbitrary suffixes are not filled.
    """
    import cv2
    crop=frame.crop(box);cuts=[]
    for threshold in (100,130,160,190):
        ink=(np.asarray(crop)<threshold).astype('uint8')
        _,_,stats,_=cv2.connectedComponentsWithStats(ink,8)
        for x,y,w,h,area in stats[1:]:
            if h<crop.height*.35 or w>h*.7 or w<2 or x<crop.width*.25 or x+w>crop.width*.82:continue
            ys,xs=np.where(ink[y:y+h,x:x+w])
            if len(ys)<4 or np.std(xs)==0 or np.std(ys)==0:continue
            correlation=float(np.corrcoef(xs,ys)[0,1])
            if correlation<=-.65:cuts.append((int(x),int(x+w),threshold,correlation))
    if not cuts:return None,{'reason':'no isolated diagonal slash glyph'}
    # Several threshold observations of one glyph are not separate symbols.
    if max(c[0]for c in cuts)-min(c[0]for c in cuts)>crop.height*.25:
        return None,{'reason':'competing diagonal glyphs','cuts':cuts}
    left,right,threshold,correlation=cuts[0];parts=[]
    for part_index,(a,b) in enumerate(((0,left),(right,crop.width))):
        partbox=[box[0]+a,box[1],box[0]+b,box[3]]
        hs=read_plain(frame,partbox,ocr,raw)
        # Shape verification uses only original full-string OCR seeds.
        query=ink_shape(frame,partbox);spec,visual=visual_read(len(shapes),shapes+[query],seeds)
        exacts=defaultdict(list)
        for h in hs:
            # Only the isolated bass slot permits case folding of a single
            # pitch letter. No minor/major suffix or flat is case-folded.
            text=h['text'].upper() if part_index==1 and len(h['text'])==1 and h['text'].lower() in 'abcdefg' else h['text']
            s=exact(text)
            if s and s.kind=='major' and s.bass is None and h['confidence']>=20:
                exacts[cm.spec_key(s)].append((s,h))
        choices=[]
        for rows in exacts.values():
            s=rows[0][0];strong=[h for _,h in rows if h['confidence']>=60]
            engines={h['source'].split('-psm')[0] for h in strong}
            visual_support=bool(visual and visual[0]['symbol']==s.surface and visual[0]['distance']<=.18
                and (len(visual)==1 or visual[1]['distance']-visual[0]['distance']>=.025))
            bass_engines={h['source'].split('-psm')[0] for _,h in rows if h['confidence']>=25}
            bass_support=bool(part_index==1 and len(bass_engines)>=2 and visual and visual[0]['symbol']==s.surface
                and visual[0]['distance']<=.23 and (len(visual)==1 or visual[1]['distance']-visual[0]['distance']>=.04))
            if len(engines)>=2 or (visual_support and strong) or bass_support:choices.append(s)
        # A low-confidence single-character OCR may be corroborated by a
        # strong source template; no lexical substitution supplies its value.
        if not choices and spec and cm.spec_key(spec) in exacts and len(spec.surface)==1:choices=[spec]
        parts.append({'spec':choices[0]if len(choices)==1 else None,'reads':hs,'visual':visual,'box':partbox})
    detail={'cuts':cuts,'parts':[{'symbol':p['spec'].surface if p['spec']else None,'reads':p['reads'],'visual':p['visual'],'sourceBox':p['box']} for p in parts]}
    if all(p['spec'] for p in parts):
        spec=exact(parts[0]['spec'].surface+'/'+parts[1]['spec'].surface)
        return spec,detail
    return None,detail


def calibrate(records,systems,links,regions,shapes):
    samples=[]
    for i,c in enumerate(records):
        if not c.get('_spec') or shapes[i] is None:continue
        match=locate_column(c['sourceBox'],c['systemIndex'],links,regions)
        if match['status']!='supported-candidate':continue
        if len(match['eventIds'])!=1:continue
        row=links[match['eventIds'][0]]
        if row['event']['kind']!='note':continue
        s=next(s for s in systems if s['systemIndex']==c['systemIndex'])
        ink=shapes[i]['inkBox'];gx=row['geometry']['center'][0]
        samples.append({'candidate':i,'eventId':row['event']['id'],'systemIndex':s['systemIndex'],
                        'leftOffsetSpaces':(gx-ink[0])/s['spacing'],
                        'centerOffsetSpaces':(gx-(ink[0]+ink[2])/2)/s['spacing']})
    if len(samples)<4:return {'supported':False,'reason':'insufficient independent printed alignment samples','samples':samples}
    fits=[]
    for mode in ('left','center'):
        center=median(r[mode+'OffsetSpaces'] for r in samples)
        good=[{**r,'offsetSpaces':r[mode+'OffsetSpaces']} for r in samples if abs(r[mode+'OffsetSpaces']-center)<=.20]
        fits.append((len(good),mode,center,good))
    _,mode,center,good=max(fits,key=lambda f:f[0])
    # At least four distinct print locations and two physical systems. This
    # fallback is page typography evidence, not a nearest-note assumption.
    if len(good)<4 or len(good)<len(samples)*.7 or len({r['systemIndex'] for r in good})<2:
        return {'supported':False,'reason':'alignment not corroborated across systems','samples':samples}
    return {'supported':True,'mode':mode,'offsetSpaces':median(r['offsetSpaces'] for r in good),
            'maxDeviationSpaces':max(abs(r['offsetSpaces']-center) for r in good),'samples':good}


def rest_column(frame,row,system,physical,links):
    """Corroborate an existing rest token by isolated in-staff source ink.

    This does not recognize a new rest/duration or amend an event. It only
    supplies a chord column where complete interval coverage already holds.
    Attention by itself is insufficient, and missing/overlapping ink rejects.
    """
    import cv2
    if not physical.get('supported') or row['event']['kind']!='rest' or not row.get('token') or not row.get('attentionEstimate'):return None
    sp=system['spacing'];x=row['attentionEstimate'][0];top=system['lines'][0];bottom=system['lines'][-1]
    if any(abs(links[id].get('geometry',{}).get('center',[1e9])[0]-x)<sp for id in physical['eventIds'] if links[id]['event']['kind']=='note'):return None
    x0=max(0,int(x-1.4*sp));x1=min(frame.width,int(x+1.4*sp)+1);y0=max(0,int(top));y1=min(frame.height,int(bottom)+1)
    # A longer strip identifies only actual spanning staff-line pixels.
    wide=(np.asarray(frame.crop((max(0,x0-int(5*sp)),y0,min(frame.width,x1+int(5*sp)),y1)))<160).astype('uint8')
    horizontal=cv2.morphologyEx(wide,cv2.MORPH_OPEN,np.ones((1,max(5,int(4*sp))),np.uint8))
    clean=wide-horizontal
    vertical=cv2.morphologyEx(wide,cv2.MORPH_OPEN,np.ones((max(3,int(.5*sp)),1),np.uint8));clean|=vertical
    start=x0-max(0,x0-int(5*sp));clean=clean[:,start:start+x1-x0]
    _,_,stats,_=cv2.connectedComponentsWithStats(clean,8);matches=[]
    for a,b,w,h,area in stats[1:]:
        if a<=0 or a+w>=clean.shape[1] or b<=0 or b+h>=clean.shape[0]:continue
        if not .8*sp<=h<=3.5*sp or not .25*sp<=w<=1.7*sp or area<sp:continue
        cx=x0+a+w/2
        if abs(cx-x)<=.65*sp:matches.append({'center':float(cx),'sourceBox':[int(x0+a),int(y0+b),int(x0+a+w),int(y0+b+h)],'inkPixels':int(area)})
    return matches[0] if len(matches)==1 else None


def attach(c,shape,system,links,regions,physical,calibration,frame):
    if not calibration['supported'] or shape is None:
        # Strict v1.1 interval coverage can corroborate a single-event measure
        # without pretending that a second note exists. No timing is inferred.
        promoted=[]
        for r in regions:
            p=physical.get(r['measure']['id'],{})
            promoted.append({**r,'status':'physical-candidate','box':p['sourceBox'],'anchorEventIds':[
                id for id in p['eventIds'] if links[id]['status']=='physical-candidate']} if p.get('supported') else r)
        return locate_column(c['sourceBox'],system['systemIndex'],links,promoted)
    ink=shape['inkBox'];base=ink[0] if calibration['mode']=='left' else (ink[0]+ink[2])/2
    x=base+calibration['offsetSpaces']*system['spacing'];sp=system['spacing']
    allowed=[]
    for r in regions:
        if r['measure']['systemIndex']!=system['systemIndex']:continue
        p=physical.get(r['measure']['id'],{})
        box=p.get('sourceBox') if p.get('supported') else r.get('box') if r['status']=='physical-candidate' else None
        if box and box[0]<x<box[2]:allowed.append((r,p,box))
    if len(allowed)!=1:return {'status':'unresolved','reason':'no unique corroborated original measure interval'}
    r,p,box=allowed[0];ids=p['eventIds'] if p.get('supported') else r['anchorEventIds'];groups=defaultdict(list)
    rest_evidence=[]
    for id in ids:
        row=links[id]
        rest=rest_column(frame,row,system,p,links) if row['status']!='physical-candidate' else None
        if row['status']!='physical-candidate' and not rest:continue
        event_x=row['geometry']['center'][0] if row['status']=='physical-candidate' else rest['center']
        d=abs(event_x-x)/sp
        if d<=.45:groups[(row['event']['measureIndex'],row['event']['onset'])].append((d,id))
        if rest and d<=.45:rest_evidence.append({'eventId':id,**rest})
    if len(groups)!=1:return {'status':'unresolved','reason':'calibrated printed anchor has no unique physical event column','anchorX':x,'alternatives':[list(k) for k in groups]}
    key,rows=next(iter(groups.items()))
    return {'status':'supported-candidate','measureIndex':key[0],'onset':key[1],
            'eventIds':[id for _,id in rows],'sourceMeasureBox':box,'anchorX':x,'restInkEvidence':rest_evidence,
            'evidence':['source barline interval corroborated independently of chord text',
                        'intact ink anchor with current-page multi-system print alignment calibration',
                        'unique physical musical event column within 0.45 staff spaces'], 'reviewRequired':True}


def recover(frame,systems,measures,links,regions,ocr,out,raw):
    """Recognition only; caller owns XML insertion and duplicate-onset guard."""
    from timeline import physical_intervals
    records=[]
    for s in systems:
        for bi,box in enumerate(boxes(frame,s)):
            hs=[asdict(h) for h in ci.ocr_chord_hypotheses(frame.crop(box),out/'ocr-chords',f"s{s['systemIndex']}-b{bi}")]
            hs+=read_plain(frame,box,ocr,raw)
            spec,options=elect(hs)
            records.append({'feature':'chord','systemIndex':s['systemIndex'],'sourceBox':box,'hypotheses':hs,
                            'options':options,'status':'unresolved','_spec':spec,'recognitionMethod':'exact whole-string OCR family agreement' if spec else None})
    shapes=[ink_shape(frame,c['sourceBox']) for c in records];seeds=templates(records,shapes)
    direct=[]
    for i,c in enumerate(records):
        if c['_spec'] is not None:continue
        spec,detail=slash_read(frame,c['sourceBox'],ocr,raw,shapes,seeds);c['slashEvidence']=detail
        if spec:
            c['_spec']=spec;c['recognitionMethod']='isolated printed slash plus separately corroborated root and bass';direct.append((i,spec))
    for i,spec in direct:seeds[cm.spec_key(spec)].append((i,spec))
    for i,c in enumerate(records):
        if c['_spec'] is None:
            spec,evidence=visual_read(i,shapes,seeds);c['visualEvidence']=evidence
            if spec is None and evidence and evidence[0]['distance']<=.18 and (len(evidence)==1 or evidence[1]['distance']-evidence[0]['distance']>=.04):
                alternatives=[exact(h['text']) for h in c['hypotheses'] if h['source']!='components']
                spec=next((s for s in alternatives if s and s.surface==evidence[0]['symbol']),None)
            if spec:c['_spec']=spec;c['recognitionMethod']='same-raster full-symbol visual corroboration; no musical-context inference'
        if c['_spec']:c['symbol']=asdict(c['_spec']);c['valueStatus']='supported-candidate'
        else:c['valueStatus']='unresolved';c['reason']='printed chord value lacks independent text/shape support'
    calibration=calibrate(records,systems,links,regions,shapes);physical=physical_intervals(measures,systems,links)
    for i,c in enumerate(records):
        s=next(s for s in systems if s['systemIndex']==c['systemIndex'])
        match=attach(c,shapes[i],s,links,regions,physical,calibration,frame);c['association']=match;c['positionStatus']=match['status']
        if c['_spec'] and match['status']=='supported-candidate':
            c.update(status='eligible-candidate',measureIndex=match['measureIndex'],onset=match['onset'])
        elif c['_spec']:c['reason']=match['reason']
    return records,{'version':VERSION,'calibration':calibration,'templateSeeds':[
        {'candidate':i,'symbol':s.surface,'sourceBox':records[i]['sourceBox']} for entries in seeds.values() for i,s in entries],
        'runtimeReferenceUsed':False,'reviewRequired':True}


def apply_candidates(measures,records):
    """Add only uniquely located printed glyphs; preserve existing harmonies.

    Reapplying recognition to an already processed XML is a no-op for matching
    chords and an explicit conflict for different values at the same onset.
    """
    from fractions import Fraction as F
    from xml.etree import ElementTree as E
    from score import insert_at_time
    groups=defaultdict(list);changes=[]
    for c in records:
        if c['status']=='eligible-candidate':groups[(c['measureIndex'],c['onset'])].append(c)
    def shape(n):return [n.tag,sorted(n.attrib.items()),(n.text or '').strip(),[shape(c) for c in n]]
    for key,cs in sorted(groups.items(),key=lambda v:(v[0][0],F(v[0][1]))):
        if len(cs)!=1:
            for c in cs:c.update(status='unresolved',reason='multiple source boxes claim same harmony onset')
            continue
        c=cs[0];m=measures[key[0]];node=cm.harmony_element(m['element'],c['_spec'],0);node.attrib.pop('default-x',None)
        # Build the proposed offset exactly as the shared insertion contract,
        # on a detached measure; no transient mutation of the live XML.
        import copy
        detached={**m,'element':E.Element('measure')};proposal=copy.deepcopy(node);insert_at_time(detached,proposal,key[1])
        at=F(0);existing=[]
        for n in m['element']:
            if n.tag=='harmony' and at+F(n.findtext('offset','0'))/m['divisions']==F(key[1]):existing.append(n)
            elif n.tag in ('backup','forward'):at+=F(n.findtext('duration','0'))/m['divisions']*(-1 if n.tag=='backup' else 1)
            elif n.tag=='note' and n.find('chord') is None:at+=F(n.findtext('duration','0'))/m['divisions']
        if existing:
            same=len(existing)==1 and shape(existing[0])==shape(proposal)
            c.update(status='preserved-existing' if same else 'unresolved',reason='identical existing harmony' if same else 'existing harmony conflicts at proposed onset')
            continue
        insert_at_time(m,node,key[1]);c['status']='applied-candidate'
        changes.append({'feature':'chord','before':None,'after':E.tostring(node,encoding='unicode'),
            'measureId':m['id'],'onset':key[1],'eventIds':c['association']['eventIds'],
            'sourceBox':c['sourceBox'],'source':VERSION,'evidence':c['association']['evidence'],'reviewRequired':True})
    return changes
