"""Source-pixel structure observations. No reference score or target totals.

The recognizer's attention is a search hint, not a glyph coordinate. Observations
are separate from musical decisions and never grant a user's review acceptance.
"""
from fractions import Fraction as F
from xml.etree import ElementTree as E
import copy, math, itertools, re
import cv2
import numpy as np

VERSION = 'hm-ending-structure-recovery-v1'


def runs(values):
    result=[]
    for value in values:
        value=int(value)
        if result and value==result[-1][-1]+1:result[-1].append(value)
        else:result.append([value])
    return result


def staff_grid(gray, system):
    """Median horizontal support resists stems, noteheads and the model's warped grid."""
    sp=system['spacing'];left=max(0,int(system['bounds'][0]));right=min(gray.shape[1],int(system['bounds'][2]))
    rough=system['lines'][0];lo=max(0,int(rough-sp));hi=min(gray.shape[0],int(rough+5*sp))
    support=np.median(255-gray[lo:hi,left:right],axis=1)
    candidates=[]
    for top in np.arange(rough-.6*sp,rough+.6*sp,.25):
        for spacing in np.arange(.9*sp,1.12*sp,.125):
            ys=np.array([top+i*spacing for i in range(5)])
            if ys[-1]>=hi:continue
            strength=np.interp(ys,np.arange(lo,hi),support)
            candidates.append((float(strength.min()+strength.mean()),ys,strength))
    if not candidates:return None
    _,ys,strength=max(candidates,key=lambda x:x[0])
    if strength.min()<15:return None
    return {'lines':ys.tolist(),'spacing':float((ys[-1]-ys[0])/4),'support':strength.tolist(),'method':'five equally spaced source raster ridges; median over staff width'}


def stem_and_beams(gray, center, spacing):
    """Accept light anti-aliased stems only with sustained vertical contrast.

    A dark-only mask previously lost real stems. Adjacent background contrast and
    a continuous run are required; threshold changes alone do not assign rhythm.
    """
    cx,cy=center;sp=spacing
    y0=max(0,int(cy-2.2*sp));y1=max(y0+1,int(cy-.9*sp))
    x0=max(2,int(cx-1.25*sp));x1=min(gray.shape[1]-3,int(cx+1.35*sp)+1)
    ranked=[]
    for x in range(x0,x1):
        stripe=gray[y0:y1,x].astype(float)
        background=np.maximum(gray[y0:y1,x-2],gray[y0:y1,x+2]).astype(float)
        contrast=background-stripe
        coverage=float(np.mean((stripe<237)&(contrast>10)))
        ranked.append((coverage,float(contrast.mean()),x))
    if not ranked:return {'status':'unresolved','reason':'no stem search pixels'}
    coverage,contrast,x=max(ranked)
    if coverage<.75 or contrast<12:return {'status':'unresolved','reason':'stem contrast/run insufficient','coverage':coverage,'contrast':contrast}
    lo=max(0,int(cy-4.2*sp));hi=max(lo+1,int(cy-.8*sp))
    half=max(2,int(1.1*sp));patch=gray[lo:hi,max(0,x-half):min(gray.shape[1],x+half+1)]
    beam_rows=np.flatnonzero((patch<150).sum(axis=1)>.72*sp)
    bands=[b for b in runs(beam_rows)if len(b)>=max(1,.2*sp)]
    result={'status':'observed','stemX':x,'stemRun':[y0,y1],'coverage':coverage,'contrast':contrast,'beamBands':[[lo+b[0],lo+b[-1]]for b in bands]}
    if len(bands) in (1,2) and all(len(b)<.8*sp for b in bands):result['beamCount']=len(bands)
    return result


def dot_observation(gray, center, spacing, staff_top):
    cx,cy=center;sp=spacing;x0=max(0,int(cx+.8*sp));x1=min(gray.shape[1],int(cx+2.7*sp));y0=max(0,int(cy-.9*sp));y1=min(gray.shape[0],int(cy+.9*sp)+1,int(staff_top-.25*sp))
    if cy>=staff_top:y1=min(gray.shape[0],int(cy+.9*sp)+1)
    if y1<=y0 or x1<=x0:return {'dots':[],'count':0,'reason':'no separate above-staff dot zone'}
    patch=(gray[y0:y1,x0:x1]<215).astype('uint8');count,labels,stats,centers=cv2.connectedComponentsWithStats(patch)
    found=[]
    for index in range(1,count):
        x,y,w,h,area=stats[index]
        if .13*sp<=w<=.65*sp and .2*sp<=h<=1.1*sp and area>=3 and .25<=w/h<=1.6 and x>0 and x+w<patch.shape[1] and y>0:
            found.append([int(x+x0),int(y+y0),int(x+x0+w),int(y+y0+h)])
    return {'dots':found,'count':len(found)}


def slash_glyphs(gray, system, grid):
    sp=grid['spacing'];left=max(0,int(system['bounds'][0]));right=min(gray.shape[1],int(system['bounds'][2]))
    top=max(0,int(grid['lines'][0]-6*sp));bottom=min(gray.shape[0],int(grid['lines'][-1]+2*sp))
    detected=cv2.createLineSegmentDetector().detect(gray[top:bottom,left:right])[0]
    if detected is None:return []
    edges=[]
    for x0,y0,x1,y1 in detected[:,0]:
        dx=float(x1-x0);dy=float(y1-y0);length=math.hypot(dx,dy);angle=math.degrees(math.atan2(abs(dy),abs(dx)))
        if dx*dy>=0 or not 44<=angle<=61 or not 1.5*sp<=length<=3*sp:continue
        cx=float((x0+x1)/2+left);cy=float((y0+y1)/2+top)
        if not grid['lines'][0]-2*sp<=cy<=grid['lines'][-1]+sp:continue
        edges.append({'center':[cx,cy],'edge':[float(x0+left),float(y0+top),float(x1+left),float(y1+top)],'angle':angle,'length':length})
    groups=[]
    for edge in sorted(edges,key=lambda x:x['center'][0]):
        found=next((g for g in groups if abs(edge['center'][0]-np.mean([v['center'][0]for v in g]))<.7*sp and abs(edge['center'][1]-np.mean([v['center'][1]for v in g]))<.65*sp),None)
        if found is None:groups.append([edge])
        else:found.append(edge)
    rows=[]
    for group in groups:
        cx,cy=np.mean([e['center']for e in group],axis=0).tolist()
        peers=sum(abs(cy-np.mean([v['center'][1]for v in other]))<.65*sp for other in groups)
        if peers<3:continue
        stem=stem_and_beams(gray,[cx,cy],sp)
        if stem['status']!='observed':continue
        # Enclosed notehead holes and compact pitched heads do not pass solely
        # because one edge happens to be diagonal. Long parallel edges, repeated
        # lane and a separate stem are independent observations.
        row={'id':f"pixel-s{system['systemIndex']}-slash-{round(cx*4)}-{round(cy*4)}",'type':'rhythm-slash','systemIndex':system['systemIndex'],'center':[cx,cy],'sourceBox':[max(0,cx-sp),max(0,cy-1.5*sp),min(gray.shape[1],cx+sp),min(gray.shape[0],cy+1.5*sp)],'edges':group,'repeatedLanePeers':int(peers),'stem':stem,'source':'original raster line edges + independent stem/beam contrast'}
        rows.append(row)
    if len(rows)<3:return []
    lane=float(np.median([r['center'][1]for r in rows]));bands=[b for r in rows for b in r['stem']['beamBands']]
    clusters=[]
    for band in sorted(bands):
        cluster=next((c for c in clusters if abs(np.mean(band)-np.mean(c))<.3*sp),None)
        if cluster is None:clusters.append([band])
        else:cluster.append(band)
    primary=max(clusters,key=len)if clusters else []
    if len(primary)<3:return rows
    primary_y=float(np.median([np.mean(b)for b in primary]))
    for row in rows:
        row['dot']=dot_observation(gray,[row['center'][0],lane],sp,grid['lines'][0])
        # A beam extends across several stems. Text above that beam is not a
        # second flag; secondary beams occur on the notehead side of the primary.
        attached=[b for b in row['stem']['beamBands']if primary_y-.35*sp<=np.mean(b)<=primary_y+1.1*sp]
        row['stem']['lanePrimaryBeamY']=primary_y;row['stem']['attachedBeamBands']=attached
        count=len(attached);dots=row['dot']['count']
        if count in (1,2) and dots<=1:row['duration']=str(F(1,2**count)*(F(3,2)if dots else 1))
    return rows


def observe_structure(frame,systems):
    gray=np.asarray(frame.convert('L'));out=[]
    for system in systems:
        grid=staff_grid(gray,system)
        if grid is None:continue
        slashes=slash_glyphs(gray,system,grid)
        if slashes:out.append({'systemIndex':system['systemIndex'],'grid':grid,'slashes':slashes})
    return out


def arc_between(gray, left, right, spacing):
    """A bowed ink path between adjacent head endpoints, separate from the beam."""
    sp=spacing;x0=int(left['center'][0]+1.25*sp);x1=int(right['center'][0]-.6*sp)
    cy=float(np.median([left['center'][1],right['center'][1]]));y0=max(0,int(cy-1.9*sp));y1=min(gray.shape[0],int(cy-.3*sp))
    if x1-x0<sp or y1<=y0:return None
    patch=gray[y0:y1,x0:x1];dark=patch.min(axis=0)<225;ys=patch.argmin(axis=0)+y0;xs=np.arange(x0,x1)
    if float(dark.mean())<.85:return None
    coef=np.polyfit(xs-xs[0],ys,2);fitted=np.polyval(coef,xs-xs[0]);residual=float(np.mean(abs(ys-fitted)))
    bow=float((fitted[0]+fitted[-1])/2-fitted[len(fitted)//2])
    if residual>.22*sp or not .18*sp<bow<1.5*sp:return None
    return {'sourceBox':[x0,y0,x1,y1],'coverage':float(dark.mean()),'bowPixels':bow,'meanResidualPixels':residual,'endpoints':[left['id'],right['id']],'method':'continuous bowed source ink below the independent beam, ending beside adjacent rhythm heads'}


def flag_observation(gray, slash, spacing):
    sp=spacing;sx=slash['stem']['stemX'];cy=slash['center'][1];top=slash['stem'].get('lanePrimaryBeamY')
    if top is None:return None
    x0=int(sx-1);x1=int(sx+1.5*sp);y0=int(top-.3*sp);y1=int(cy-.4*sp)
    x0=max(0,x0);y0=max(0,y0);x1=min(gray.shape[1],x1);y1=min(gray.shape[0],y1)
    if y1<=y0 or x1<=x0:return None
    patch=(gray[y0:y1,x0:x1]<190).astype('uint8');count,labels,stats,centers=cv2.connectedComponentsWithStats(patch)
    candidates=[]
    for i in range(1,count):
        x,y,w,h,area=stats[i]
        if x<=.4*sp and .45*sp<w<1.6*sp and .9*sp<h<3.2*sp and area>.4*sp*sp:
            candidates.append({'sourceBox':[int(x0+x),int(y0+y),int(x0+x+w),int(y0+y+h)],'area':int(area),'method':'single downward flag body beside independently observed stem; no spanning beam'})
    return candidates[0]if len(candidates)==1 else None


def open_heads(gray, system, grid):
    """Holes at several thresholds plus the original detected head, not token type."""
    result=[];sp=grid['spacing']
    for glyph in system['symbols']:
        if glyph['type']!='Note':continue
        cx,cy=glyph['center'];x0=max(0,int(cx-1.25*sp));x1=min(gray.shape[1],int(cx+1.25*sp)+1);y0=max(0,int(cy-1.2*sp));y1=min(gray.shape[0],int(cy+1.2*sp)+1)
        holes=[]
        for threshold in (150,160,180,200):
            contours,hierarchy=cv2.findContours((gray[y0:y1,x0:x1]<threshold).astype('uint8'),cv2.RETR_CCOMP,cv2.CHAIN_APPROX_SIMPLE)
            if hierarchy is None:continue
            for i,contour in enumerate(contours):
                if hierarchy[0][i][3]<0:continue
                x,y,w,h=cv2.boundingRect(contour);area=cv2.contourArea(contour)
                if .06*sp*sp<area<sp*sp and .25*sp<w<1.3*sp and .25*sp<h<1.3*sp and abs(x0+x+w/2-cx)<.65*sp and abs(y0+y+h/2-cy)<.65*sp:
                    holes.append({'threshold':threshold,'box':[x0+x,y0+y,x0+x+w,y0+y+h],'area':float(area)})
        if len({h['threshold']for h in holes})<2:continue
        center=np.median([[(h['box'][0]+h['box'][2]-1)/2,(h['box'][1]+h['box'][3]-1)/2]for h in holes],axis=0).tolist()
        result.append({'id':glyph['id'],'center':center,'head':glyph,'holes':holes,'sourceBox':[x0,y0,x1,y1]})
    return result


def source_rest(gray, token, spacing):
    """Corroborate a raw rest token with ink, never fill an empty duration gap."""
    xy=token.get('attentionOriginal');rhythm=token.get('fields',{}).get('rhythm','')
    if xy is None or rhythm!='rest_8' or token['fields'].get('pitch')!='_':return None
    x,y=xy;sp=spacing;x0=max(0,int(x-1.2*sp));x1=min(gray.shape[1],int(x+1.2*sp));y0=max(0,int(y-1.5*sp));y1=min(gray.shape[0],int(y+2*sp))
    if y1<=y0 or x1<=x0:return None
    contours,_=cv2.findContours((gray[y0:y1,x0:x1]<180).astype('uint8'),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    good=[]
    for c in contours:
        a,b,w,h=cv2.boundingRect(c);area=cv2.contourArea(c)
        if .4*sp<w<1.45*sp and 1.1*sp<h<2.7*sp and area>.25*sp*sp and a>0 and b>0 and a+w<x1-x0 and b+h<y1-y0:
            good.append({'id':f"pixel-rest-token-{token['tokenIndex']}",'type':'rest','duration':'1/2','center':[x0+a+w/2,y0+b+h/2],'sourceBox':[x0+a,y0+b,x0+a+w,y0+b+h],'tokenIndex':token['tokenIndex'],'rawToken':token['text'],'method':'raw eighth-rest token AND bounded nonempty rest-shaped source component; not a timing repair'})
    return good[0]if len(good)==1 else None


def align_slashes(events,glyphs,arcs,links,spacing):
    """Order/curve-constrained lineage; attention only ranks otherwise valid paths."""
    n=len(events);g=len(glyphs)
    if not 0<=g-n<=2 or g>24:return None
    source_edges={(a,b)for a,b,_ in arcs};model_edges=[]
    for i,event in enumerate(events[:-1]):
        node=event['element'];nxt=events[i+1]['element']
        if node.find('tie[@type="start"]')is not None and nxt.find('tie[@type="stop"]')is not None:model_edges.append((i,i+1))
    ranked=[]
    for indexes in itertools.combinations(range(g),n):
        if any((indexes[a],indexes[b])not in source_edges for a,b in model_edges):continue
        score=0
        for e,i in zip(events,indexes):
            xy=links.get(e['id'],{}).get('attentionEstimate')
            if xy is None:score+=8
            else:score+=min(12,abs(xy[0]-glyphs[i]['center'][0])/spacing)
        ranked.append((score,indexes))
    ranked.sort()
    if not ranked or len(ranked)>1 and ranked[1][0]-ranked[0][0]<.6:return None
    return {'indices':list(ranked[0][1]),'score':ranked[0][0],'runnerUpMargin':ranked[1][0]-ranked[0][0]if len(ranked)>1 else None,'method':'monotone source order and independently observed curve endpoints; weak attention cost only breaks otherwise valid lineage candidates','modelCurveEdges':model_edges}


def pitch_at(position,clef,fifths):
    sign,line=clef;anchor={'G':(4,'G'),'F':(3,'F'),'C':(4,'C')}.get(sign)
    if anchor is None:return None
    bottom=anchor[0]*7+'CDEFGAB'.index(anchor[1])-2*(line-1)
    value=bottom+position-1;step='CDEFGAB'[value%7];alter=0
    if fifths<0 and step in 'BEADGCF'[:min(7,-fifths)]:alter=-1
    if fifths>0 and step in 'FCGDAEB'[:min(7,fifths)]:alter=1
    return {'step':step,'octave':value//7,'alter':alter}


def set_child(node,tag,value):
    child=node.find(tag)
    if child is None:child=E.SubElement(node,tag)
    child.text=str(value)


def make_note(original,kind,duration,voice,divisions,pitch=None,ties=()):
    node=copy.deepcopy(original)if original is not None else E.Element('note')
    for child in list(node):
        if child.tag in ['pitch','rest','unpitched','duration','voice','type','dot','chord','notehead','tie','stem','beam'] or child.tag=='accidental'and kind!='note':node.remove(child)
    notation=node.find('notations')
    if notation is not None:
        for child in list(notation):
            if child.tag == 'tied':notation.remove(child)
    if kind=='note':
        p=E.Element('pitch');E.SubElement(p,'step').text=pitch['step']
        if pitch['alter']:E.SubElement(p,'alter').text=str(pitch['alter'])
        E.SubElement(p,'octave').text=str(pitch['octave']);node.insert(0,p)
    elif kind=='rhythm':
        p=E.Element('unpitched');E.SubElement(p,'display-step').text='B';E.SubElement(p,'display-octave').text='4';node.insert(0,p)
    else:node.insert(0,E.Element('rest'))
    units=F(duration)*divisions
    if units.denominator!=1:raise ValueError('Detected duration is not expressible with existing divisions')
    at=1;d=E.Element('duration');d.text=str(units.numerator);node.insert(at,d);at+=1
    for tie in ties:
        node.insert(at,E.Element('tie',type=tie));at+=1
    v=E.Element('voice');v.text=voice;node.insert(at,v);at+=1
    types={F(4):('whole',False),F(3):('half',True),F(2):('half',False),F(1):('quarter',False),F(3,4):('eighth',True),F(1,2):('eighth',False),F(3,8):('16th',True),F(1,4):('16th',False)}
    typ,dotted=types[F(duration)];t=E.Element('type');t.text=typ;node.insert(at,t);at+=1
    if dotted:node.insert(at,E.Element('dot'));at+=1
    if kind=='rhythm':h=E.Element('notehead');h.text='slash';node.insert(at,h)
    if node.find('staff')is None:E.SubElement(node,'staff').text='1'
    if ties:
        if notation is None:notation=E.SubElement(node,'notations')
        for tie in ties:E.SubElement(notation,'tied',type=tie)
    return node


def rewrite_measure(measure,entries):
    """Retain note ordinals/IDs; explicit clock moves encode concurrent voices."""
    element=measure['element'];old=list(element);first=next((i for i,n in enumerate(old)if n.tag in ['note','backup','forward']),len(old))
    before=[n for i,n in enumerate(old)if i<first and n.tag not in ['note','backup','forward']]
    after=[n for i,n in enumerate(old)if i>=first and n.tag not in ['note','backup','forward']]
    cursor=F(0);result=list(before)
    for row in entries:
        onset=F(row['onset']);delta=onset-cursor
        if delta:
            clock=E.Element('forward'if delta>0 else 'backup');units=abs(delta)*measure['divisions']
            if units.denominator!=1:raise ValueError('Unrepresentable clock move')
            E.SubElement(clock,'duration').text=str(units.numerator);result.append(clock)
        result.append(row['node']);cursor=onset+F(row['duration'])
    element[:]=result+after


def edge_curve(gray,head,system,side):
    sp=system['spacing'];cx,cy=head['center']
    x0=int(cx+.4*sp)if side=='out'else int(cx-2.4*sp)
    x1=int(min(system['bounds'][2]-.15*sp,cx+2.5*sp))if side=='out'else int(cx-.35*sp)
    y0=max(0,int(cy+.3*sp));y1=min(gray.shape[0],int(cy+1.75*sp))
    x0=max(0,x0);x1=min(gray.shape[1],x1)
    if x1-x0<sp:return None
    left=max(0,int(system['bounds'][0]));right=min(gray.shape[1],int(system['bounds'][2]))
    background=np.median(gray[y0:y1,left:right],axis=1).astype(float)
    ink=np.maximum(background[:,None]-gray[y0:y1,x0:x1].astype(float)-20,0);mass=ink.sum(axis=0);valid=mass>35
    if float(valid.mean())<.75:return None
    xs=np.arange(x0,x1)[valid];ys=(ink*np.arange(y0,y1)[:,None]).sum(axis=0)[valid]/mass[valid]
    fit=np.polyfit(xs-xs[0],ys,2);curve=np.polyval(fit,xs-xs[0]);bow=float(curve[len(curve)//2]-(curve[0]+curve[-1])/2)
    residual=float(np.mean(abs(ys-curve)));near=ys[0]if side=='out'else ys[-1]
    if not .12*sp<bow<2*sp or residual>.35*sp or abs(near-cy)>1.4*sp:return None
    return {'sourceBox':[x0,y0,x1,y1],'direction':side,'bowPixels':bow,'meanResidualPixels':residual,'inkCoverage':float(valid.mean()),'staffBackgroundRemoved':True,'headId':head['id'],'method':'short bowed ink beside head and system edge, independently corroborated at both systems'}


def recover(root,frame,systems,links,regions,history,candidates,input_sha256):
    """Conservative, bounded mixed rhythm/pitched structural reconstruction.

    Runs after current automatic text/time supplements, so immutable old token
    IDs and exact lyric/harmony attachments remain available for the history.
    """
    from score import observe
    prior=[c for c in history if c.get('ruleVersion')==VERSION]
    if prior:
        by={f'p{pi}m{mi}':m for pi,p in enumerate(root.findall('part'))for mi,m in enumerate(p.findall('measure'))}
        if any(E.tostring(by[c['measureId']],encoding='unicode')!=c['after']for c in prior):raise ValueError('Structure reapplication does not match recorded result')
        return {'version':VERSION,'changes':[],'decisions':[],'reapplied':True,'additionalChanges':0}
    gray=np.asarray(frame.convert('L'));observations=observe_structure(frame,systems);measures,events=observe(root);decisions=[];changes=[];original={};entry_maps={};lineage={};fifths={};key=0
    for measure in measures:
        k=measure['element'].findtext('attributes/key/fifths')
        if k is not None:key=int(k)
        fifths[measure['id']]=key
    def edit_rows(measure):
        mid=measure['id']
        if mid not in entry_maps:
            original[mid]=E.tostring(measure['element'],encoding='unicode')
            entry_maps[mid]=[{'node':copy.deepcopy(e['element']),'onset':e['onset'],'duration':e['duration']}for e in measure['events']]
            lineage[mid]=[{'afterEventId':e['id'],'beforeEventIds':[e['id']],'operation':'preserved','sourceGlyphIds':[]}for e in measure['events']]
        return entry_maps[mid]
    for observation in observations:
        si=observation['systemIndex'];system=systems[si];grid=observation['grid'];sp=grid['spacing'];holes=open_heads(gray,system,grid)
        bars=sorted([system['bounds'][0],system['bounds'][2]]+[g['center'][0]for g in system['symbols']if g['type']=='BarLine']);bounds=[]
        for x in bars:
            if not bounds or x-bounds[-1]>.8*sp:bounds.append(x)
        current=[m for m in measures if m['systemIndex']==si]
        for measure in current:
            hints=[links.get(e['id'],{}).get('attentionEstimate')for e in measure['events']];hints=[h for h in hints if h]
            intervals={i for h in hints for i in range(len(bounds)-1)if bounds[i]<h[0]<bounds[i+1]}
            decision={'feature':'ending-structure','status':'withheld-candidate','ruleVersion':VERSION,'measureId':measure['id'],'systemIndex':si,'inputSha256':input_sha256,'reviewRequired':True}
            if len(intervals)!=1:decision['reason']='raw event search hints cross physical barlines';decisions.append(decision);continue
            interval=next(iter(intervals));left,right=bounds[interval:interval+2];glyphs=[g for g in observation['slashes']if left<g['center'][0]<right]
            if len(glyphs)<3:continue
            decision['sourceBox']=[left,max(0,grid['lines'][0]-5*sp),right,min(frame.height,grid['lines'][-1]+2*sp)]
            localholes=[h for h in holes if left<h['center'][0]<right];long_events=[e for e in measure['events']if e['kind']=='note'and F(e['duration'])>=2]
            if len(localholes)!=1 or len(long_events)!=1:decision['reason']='mixed lane needs a unique independently hollow pitched head';decisions.append(decision);continue
            hollow=localholes[0];long=long_events[0];long_hint=links.get(long['id'],{}).get('attentionEstimate')
            if long['element'].find('accidental')is not None:
                decision['reason']='explicit accidental on reassigned hollow head needs independent recovery';decisions.append(decision);continue
            if long_hint is None or abs(long_hint[0]-hollow['center'][0])>2*sp:decision['reason']='long token and hollow source head disagree';decisions.append(decision);continue
            # Whole-head role requires its broad printed shape and a stem
            # already attributable to the separate adjacent slash. A missing
            # stem alone never promotes a half note to a whole note.
            width,height=hollow['head']['size'];adjacent=[g for g in glyphs if abs(g['center'][0]-hollow['center'][0])<1.8*sp]
            whole=width/height>=1.3 and len(adjacent)==1 and abs(adjacent[0]['stem']['stemX']-hollow['center'][0])<sp
            half=width/height<1.2 and hollow['head'].get('stemDirection')=='UP'and not adjacent
            # A separate downward stem below a hollow lower head resolves a
            # sustained half/dotted-half lane; it must not be promoted to whole.
            down_stem=stem_and_beams(np.flipud(gray),[hollow['center'][0],gray.shape[0]-1-hollow['center'][1]],sp)if hollow['head'].get('stemDirection')=='DOWN'else None
            head_dot=dot_observation(gray,hollow['center'],sp,hollow['center'][1]+2*sp)
            down_half=bool(down_stem and down_stem['status']=='observed'and hollow['center'][1]>grid['lines'][-1]and len(adjacent)==1 and long['element'].findtext('type')=='half'and head_dot['count']==len(long['element'].findall('dot'))<=1)
            if down_half:whole=False
            if not(whole or half or down_half):decision['reason']='hollow head/stem ownership is ambiguous';decisions.append(decision);continue
            physical={}
            for e in measure['events']:
                if e is long or e['kind']!='note':continue
                xy=links.get(e['id'],{}).get('attentionEstimate')
                if xy is None:continue
                matches=[g for g in system['symbols']if g['type']=='Note'and g['id']!=hollow['id']and abs(g['center'][0]-xy[0])<1.6*sp and g['center'][1]>grid['lines'][0]+.35*sp]
                if len(matches)==1:physical[e['id']]=matches[0]
            rhythm_events=[e for e in measure['events']if e is not long and e['kind']in ('note','rhythm')and e['id']not in physical]
            arcs=[(i,i+1,a)for i,(g,n)in enumerate(zip(glyphs,glyphs[1:]))if(a:=arc_between(gray,g,n,sp))]
            alignment=align_slashes(rhythm_events,glyphs,arcs,links,sp)
            if alignment is None:decision['reason']='source order/curve lineage is not unique';decisions.append(decision);continue
            mapped_edges={(alignment['indices'][a],alignment['indices'][b])for a,b in alignment['modelCurveEdges']}
            if any((a,b)not in mapped_edges for a,b,_ in arcs) or any(e['element'].find('notations/slur')is not None for e in rhythm_events):
                decision['reason']='unclassified rhythm curve; preserve pending review';decisions.append(decision);continue
            for event,gi in zip(rhythm_events,alignment['indices']):
                glyph=glyphs[gi]
                if 'duration'not in glyph:
                    flag=flag_observation(gray,glyph,sp)
                    if flag and F(event['duration'])==F(1,2)and event['element'].findtext('type')=='eighth':glyph['flag']=flag;glyph['duration']='1/2'
            if any('duration'not in g for g in glyphs):decision['reason']='a slash lacks beam/flag/dot duration evidence';decisions.append(decision);continue
            if any((F(g['duration'])*measure['divisions']).denominator!=1 for g in glyphs):
                decision['reason']='observed rhythm cannot be represented on current divisions grid';decisions.append(decision);continue
            rests=[e for e in measure['events']if e['kind']=='rest'];upper_rest=None
            if half:
                if long['element'].find('tie')is not None or long['element'].find('notations/slur')is not None:
                    decision['reason']='unclassified connection on concurrent long note';decisions.append(decision);continue
                # A missing upper rest is recovered only from a separate raw
                # token AND original ink, aligned with the lower rest column.
                rest_pixels=[r for t in system['tokens']if(r:=source_rest(gray,t,sp))and left<r['center'][0]<glyphs[0]['center'][0]and r['center'][1]<grid['lines'][0]]
                if len(rest_pixels)!=1 or not rests or len(physical)<2:decision['reason']='independent concurrent voice/rest anchors missing';decisions.append(decision);continue
                upper_rest=rest_pixels[0];upper_rest['id']=f"pixel-s{si}-rest-token-{upper_rest['tokenIndex']}";first_rest=rests[0];hint=links.get(first_rest['id'],{}).get('attentionEstimate')
                if hint is None or abs(hint[0]-upper_rest['center'][0])>1.5*sp:decision['reason']='upper/lower rest onset columns conflict';decisions.append(decision);continue
                tail=rests[1:]+[e for e in measure['events']if e['id']in physical]
                if not tail or abs(links.get(tail[0]['id'],{}).get('attentionEstimate',[1e9])[0]-hollow['center'][0])>1.5*sp:decision['reason']='second independent voice alignment column missing';decisions.append(decision);continue
            elif rests or physical:decision['reason']='sustained whole-note lane has other unassigned events';decisions.append(decision);continue
            rows=edit_rows(measure);mid=measure['id'];onset=F(upper_rest['duration'])if upper_rest else F(0);glyph_onsets=[]
            for g in glyphs:glyph_onsets.append(onset);onset+=F(g['duration'])
            rhythm_voice='2';lead_voice='1';by_glyph={gi:e for e,gi in zip(rhythm_events,alignment['indices'])}
            for gi,g in enumerate(glyphs):
                event=by_glyph.get(gi);tieflags=(['start']if any(a==gi for a,b,_ in arcs)else [])+(['stop']if any(b==gi for a,b,_ in arcs)else [])
                node=make_note(event['element']if event else None,'rhythm',g['duration'],rhythm_voice,measure['divisions'],ties=tieflags);row={'node':node,'onset':str(glyph_onsets[gi]),'duration':g['duration']}
                if event:ni=event['noteIndex'];rows[ni]=row
                else:ni=len(rows);rows.append(row);lineage[mid].append({'afterEventId':f'd0{mid}n{ni}','beforeEventIds':[],'operation':'inserted','sourceGlyphIds':[]})
                lineage[mid][ni].update(operation='modified'if event else 'inserted',sourceGlyphIds=[g['id']],sourceBox=g['sourceBox'],reason='independently detected slash/stem/beam/dot; voice clock follows lane',sourceOnset=str(glyph_onsets[gi]))
            y=hollow['center'][1];position=round(9-2*(y-grid['lines'][0])/sp)if whole else int(hollow['head']['staffPosition']);pitch=pitch_at(position,long['clef'],fifths[mid]);duration='4'if whole else '3'if down_half and head_dot['count']else '2'
            rows[long['noteIndex']]={'node':make_note(long['element'],'note',duration,lead_voice if whole or down_half else rhythm_voice,measure['divisions'],pitch=pitch),'onset':'0'if whole or down_half else str(onset),'duration':duration}
            lineage[mid][long['noteIndex']].update(operation='modified',sourceGlyphIds=[hollow['id']],sourceBox=hollow['sourceBox'],reason='hollow head shape, independent stem ownership and raster staff grid',headRole='whole'if whole else 'half')
            if half:
                lower=F(0)
                for event in [rests[0]]+tail:
                    old=event['element'];kind=event['kind'];p=None
                    if kind=='note':
                        g=physical[event['id']];pos=int(g['staffPosition']);grid_pos=9-2*(g['center'][1]-grid['lines'][0])/sp
                        # Retain an already agreeing model pitch. A correction
                        # needs independent geometry and raster-grid agreement.
                        oldp={'step':old.findtext('pitch/step'),'octave':int(old.findtext('pitch/octave')),'alter':int(old.findtext('pitch/alter','0'))};p=oldp
                        inferred=pitch_at(pos,event['clef'],fifths[mid])
                        if abs(grid_pos-pos)<=.7 and old.find('accidental')is None and (oldp['step'],oldp['octave'])!=(inferred['step'],inferred['octave']):p=inferred
                    tieflags=[t.attrib['type']for t in old.findall('tie')]
                    node=make_note(old,kind,event['duration'],lead_voice,measure['divisions'],pitch=p,ties=tieflags);rows[event['noteIndex']]={'node':node,'onset':str(lower),'duration':event['duration']};lower+=F(event['duration'])
                    lineage[mid][event['noteIndex']].update(operation='modified',sourceGlyphIds=[physical[event['id']]['id']]if event['id']in physical else [],reason='separate lower stem/rest stream with two physical alignment columns')
                ni=len(rows);rows.append({'node':make_note(None,'rest',upper_rest['duration'],rhythm_voice,measure['divisions']),'onset':'0','duration':upper_rest['duration']});lineage[mid].append({'afterEventId':f'd0{mid}n{ni}','beforeEventIds':[],'operation':'inserted','sourceGlyphIds':[upper_rest['id']],'sourceBox':upper_rest['sourceBox'],'reason':upper_rest['method'],'rawTokenIndex':upper_rest['tokenIndex']})
            decision.update(status='applied-candidate',reason='independent source roles and concurrent voice anchors resolved',glyphs=glyphs,hollowHead=hollow,headRole='whole'if whole else 'lower-half'if down_half else 'upper-half',independentDownStem=down_stem,headDots=head_dot,alignment=alignment,curveEvidence=[a for _,_,a in arcs],upperRest=upper_rest,durationFitting=False)
            decisions.append(decision)
    # Only an already paired raw cross-system slur, now shown by both original
    # head-adjacent arcs to join the sustained same pitch, can become a tie.
    for i,measure in enumerate(measures):
        mid=measure['id']
        whole_decision=next((d for d in decisions if d.get('measureId')==mid and d['status']=='applied-candidate'and d.get('headRole')=='whole'),None)
        if not whole_decision or i==0:continue
        previous=measures[i-1]
        if previous['partIndex']!=measure['partIndex']or previous['systemIndex']+1!=measure['systemIndex']:continue
        starts=[e for e in previous['events']if e['element'].find('notations/slur[@type="start"]')is not None]
        stops=[e for e in measure['events']if e['element'].find('notations/slur[@type="stop"]')is not None and F(e['duration'])>=2]
        if len(starts)!=1 or len(stops)!=1:continue
        start,stop=starts[0],stops[0];old_start=start['element'];old_stop=stop['element'];ss=old_start.find('notations/slur[@type="start"]');st=old_stop.find('notations/slur[@type="stop"]')
        new_stop=entry_maps[mid][stop['noteIndex']]['node']
        if ss.get('number','1')!=st.get('number','1')or old_stop.find('lyric')is not None or old_start.find('notations/articulations')is not None or old_stop.find('notations/articulations')is not None:continue
        if old_start.findtext('pitch/step')!=new_stop.findtext('pitch/step')or old_start.findtext('pitch/octave')!=new_stop.findtext('pitch/octave')or old_start.findtext('pitch/alter','0')!=new_stop.findtext('pitch/alter','0'):continue
        start_head=links.get(start['id'],{}).get('geometry');stop_head=whole_decision['hollowHead']
        if not start_head or start is not previous['events'][-1]:continue
        outgoing=edge_curve(gray,start_head,systems[previous['systemIndex']],'out');incoming=edge_curve(gray,stop_head,systems[measure['systemIndex']],'in')
        if not outgoing or not incoming:continue
        prows=edit_rows(previous);pnode=prows[start['noteIndex']]['node'];notation=pnode.find('notations')
        for slur in list(notation.findall('slur')):
            if slur.get('number','1')==ss.get('number','1'):notation.remove(slur)
        pnode.insert(next((n for n,c in enumerate(pnode)if c.tag in ['voice','type','staff','notations']),len(pnode)),E.Element('tie',type='start'));E.SubElement(notation,'tied',type='start')
        new_stop.insert(next((n for n,c in enumerate(new_stop)if c.tag in ['voice','type','staff','notations']),len(new_stop)),E.Element('tie',type='stop'));notation=new_stop.find('notations')
        if notation is None:notation=E.SubElement(new_stop,'notations')
        for slur in list(notation.findall('slur')):
            if slur.get('number','1')==st.get('number','1'):notation.remove(slur)
        E.SubElement(notation,'tied',type='stop')
        lineage[previous['id']][start['noteIndex']].update(operation='modified',sourceGlyphIds=[start_head['id']],sourceBox=outgoing['sourceBox'],reason='paired source-system boundary arcs join same sustained pitch without a new syllable')
        lineage[mid][stop['noteIndex']]['connectionEvidence']={'fromEventId':start['id'],'departure':outgoing,'arrival':incoming,'samePitch':True,'sameVoice':True}
        decisions.append({'feature':'ending-structure','status':'applied-candidate','ruleVersion':VERSION,'measureId':previous['id'],'inputSha256':input_sha256,'sourceBox':outgoing['sourceBox'],'reason':'cross-system curve endpoints and independently restored same pitch identify the sustained tie','curveEvidence':[outgoing,incoming],'reviewRequired':True})
    # A text collision is separate from voice reconstruction. All retained OCR
    # reads must identify a chord-letter family, not tr/trill, and the nearby
    # ornament zone must have no additional ink outside that exact text box.
    for measure in measures:
        system=systems[measure['systemIndex']];grid=staff_grid(gray,system)
        if grid is None:continue
        sp=grid['spacing']
        for event in measure['events']:
            if event['element'].find('notations/ornaments/trill-mark')is None:continue
            if event['element'].find('accidental')is not None:continue
            hint=links.get(event['id'],{}).get('attentionEstimate')
            if hint is None:continue
            texts=[c for c in candidates if c.get('feature')=='chord'and c.get('systemIndex')==measure['systemIndex']and c.get('sourceBox')and c['sourceBox'][0]-sp<hint[0]<c['sourceBox'][2]+sp]
            if len(texts)!=1:continue
            text=texts[0];reads=[h['text'].strip()for h in text.get('hypotheses',[])if h.get('confidence',0)>=35]
            if len(reads)<3 or not all(re.fullmatch(r'[A-G][b#smj0-9()+/\-]*',r)for r in reads):continue
            box=text['sourceBox'];x0=max(0,int(box[0]-sp));x1=min(frame.width,int(box[2]+sp));y0=max(0,int(box[1]));y1=max(y0+1,int(grid['lines'][0]-.8*sp));zone=gray[y0:y1,x0:x1].copy();zone[max(0,int(box[1])-y0):min(y1,int(box[3]))-y0,max(0,int(box[0])-x0):min(x1,int(box[2]))-x0]=255
            if float(np.mean(zone<160))>.01:continue
            heads=[g for g in system['symbols']if g['type']=='Note'and abs(g['center'][0]-hint[0])<1.4*sp]
            if len(heads)!=1:continue
            head=heads[0];position=int(head['staffPosition']);pixel=9-2*(head['center'][1]-grid['lines'][0])/sp
            if abs(pixel-position)>.7:continue
            rows=edit_rows(measure);node=rows[event['noteIndex']]['node'];ornaments=node.find('notations/ornaments');ornaments.remove(ornaments.find('trill-mark'))
            if len(ornaments)==0:node.find('notations').remove(ornaments)
            pitch=pitch_at(position,event['clef'],fifths[measure['id']]);p=node.find('pitch')
            if p is None:continue
            p.clear();E.SubElement(p,'step').text=pitch['step']
            if pitch['alter']:E.SubElement(p,'alter').text=str(pitch['alter'])
            E.SubElement(p,'octave').text=str(pitch['octave'])
            lineage[measure['id']][event['noteIndex']].update(operation='modified',sourceGlyphIds=[head['id']],sourceBox=box,reason='separate chord-letter ink and notehead/staff position contradict model ornament/pitch')
            decisions.append({'feature':'ending-structure','status':'applied-candidate','ruleVersion':VERSION,'measureId':measure['id'],'eventId':event['id'],'inputSha256':input_sha256,'sourceBox':box,'reason':'chord-text collision; no independent trill glyph in ornament zone','ocrReads':reads,'sourceGlyphId':head['id'],'rasterStaffPosition':pixel,'chordValueChanged':False,'reviewRequired':True})
    for measure in measures:
        mid=measure['id']
        if mid not in entry_maps:continue
        rewrite_measure(measure,entry_maps[mid]);after=E.tostring(measure['element'],encoding='unicode')
        if original[mid]==after:continue
        relevant=[d for d in decisions if d.get('measureId')==mid and d['status']=='applied-candidate']
        changes.append({'feature':'ending-structure','ruleVersion':VERSION,'measureId':mid,'eventIds':[e['id']for e in measure['events']],'before':original[mid],'after':after,'lineage':lineage[mid],'deletedEventIds':[],'sourceBox':relevant[0]['sourceBox'],'inputSha256':input_sha256,'evidence':['original source pixel roles; exact old measure and stable event lineage','independent per-voice clocks, never clipping or fitting to meter'],'reviewRequired':True})
    return {'version':VERSION,'changes':changes,'decisions':decisions,'observations':observations,'runtimeReferenceUsed':False,'userApprovalGranted':False}
