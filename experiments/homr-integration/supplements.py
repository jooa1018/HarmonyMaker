"""Source-pixel supplements. Conservative candidates, never reconstructed reference data."""
from collections import Counter,defaultdict
from fractions import Fraction as F
from xml.etree import ElementTree as ET
import re,json,math
import cv2,numpy as np
from PIL import Image,ImageOps
from linking import locate_column
from geometry import write

def save_crop(frame,box,out,name,scale=3):
    out.mkdir(parents=True,exist_ok=True);box=tuple(map(int,box));crop=frame.crop(box);crop.save(out/(name+'.source.png'))
    enlarged=ImageOps.expand(crop.resize((crop.width*scale,crop.height*scale)),12,fill=255);enlarged.save(out/(name+'.ocr.png'))
    return enlarged

def lyrics(frame,systems,measures,events,links,regions,ocr,out,raw,changes,language):
    candidates=[];event_map={e['id']:e for e in events}
    for s in systems:
        si=s['systemIndex'];sp=s['spacing'];bottom=s['lines'][-1]
        next_top=systems[si+1]['lines'][0]-5*sp if si+1<len(systems) else frame.height
        box=[max(0,int(s['bounds'][0])),int(bottom+2.0*sp),min(frame.width,int(s['bounds'][2]+sp)),min(frame.height,int(bottom+7.5*sp),int(next_top))]
        if box[3]<=box[1]:continue
        crop=save_crop(frame,box,out/'ocr-lyrics',f's{si}')
        words=ocr.recognize(crop,language=language,psm=6);symbols=ocr.recognize(crop,language=language,psm=6,symbols=True)
        raw.append({'feature':'lyrics','systemIndex':si,'sourceBox':box,'transform':{'scale':3,'padding':12},'language':language,'psm':6,'words':words,'symbols':symbols})
        def original(b):return [(b[0]-12)/3+box[0],(b[1]-12)/3+box[1],(b[2]-12)/3+box[0],(b[3]-12)/3+box[1]]
        units=[]
        for wi,w in enumerate(words):
            if w['confidence']<60 or not re.search(r'[A-Za-z가-힣]',w['text']):continue
            # OCR's actual symbol boxes split Hangul syllables; no character-width interpolation.
            if re.search(r'[가-힣]',w['text']):
                ss=[u for u in symbols if re.fullmatch(r'[가-힣]',u['text']) and u['box'][0]>=w['box'][0]-2 and u['box'][2]<=w['box'][2]+2 and abs(u['box'][1]-w['box'][1])<15]
                units.extend({**u,'wordIndex':wi,'textKind':'Hangul syllable'} for u in ss if u['confidence']>=60)
            else:units.append({**w,'wordIndex':wi,'textKind':'OCR word; internal syllables not inferred'})
        # A baseline is a spatial line, not an asserted verse number.
        lines=[]
        for u in sorted(units,key=lambda w:w['box'][1]):
            y=(u['box'][1]+u['box'][3])/2
            group=next((g for g in lines if abs(g['y']-y)<sp*3*.8),None)
            if group is None:group={'y':y,'items':[]};lines.append(group)
            group['items'].append(u)
        for line_index,line in enumerate(lines):
            if len(line['items'])<2:continue
            pending=[];votes=Counter()
            for u in sorted(line['items'],key=lambda w:w['box'][0]):
                b=original(u['box']);match=locate_column(b,si,links,regions,kind='lyric')
                row={'feature':'lyric','systemIndex':si,'sourceBox':b,'text':u['text'],'confidence':u['confidence'],'ocrWordIndex':u['wordIndex'],'textKind':u['textKind'],'spatialLineIndex':line_index,'verseStatus':'unconfirmed' if len(lines)>1 else 'single visible lyric line candidate','syllabicStatus':'not inferred inside a recognized word','extendStatus':'not inferred','association':match,'status':'unresolved'}
                if match['status']=='supported-candidate':
                    ids=[id for id in match['eventIds'] if event_map[id]['kind']=='note'];voices={event_map[id]['voice'] for id in ids}
                    if len(voices)==1 and ids:votes[next(iter(voices))]+=1
                    row['eligibleIds']=ids
                pending.append(row)
            dominant=votes.most_common();voice=dominant[0][0] if dominant and dominant[0][1]>=2 and (len(dominant)==1 or dominant[0][1]>=dominant[1][1]+2) else None
            for row in pending:
                ids=row.pop('eligibleIds',[])
                if len(ids)>1:ids=[id for id in ids if event_map[id]['voice']==voice]
                if len(ids)==1 and len(lines)==1 and '-' not in row['text'] and '_' not in row['text']:
                    e=event_map[ids[0]];n=e['element']
                    if n.find('lyric') is None:
                        lyric=ET.SubElement(n,'lyric',number='1');ET.SubElement(lyric,'syllabic').text='single';ET.SubElement(lyric,'text').text=row['text']
                        row.update(status='applied-candidate',eventId=ids[0],voice=e['voice'],syllabicStatus='single visible text unit candidate; melisma/hyphen fidelity not certified')
                        changes.append({'feature':'lyric','before':None,'after':ET.tostring(lyric,encoding='unicode'),'eventIds':ids,'sourceBox':row['sourceBox'],'source':'local Tesseract word/symbol boxes','evidence':row['association']['evidence']+['single lyric baseline','unique note or corroborated lyric-line voice'],'reviewRequired':True})
                    else:row['reason']='two text units compete for one note'
                else:row['reason']='voice, verse, syllable or melisma association unresolved'
                candidates.append(row)
    return candidates

def meter(frame,systems,measures,events,links,regions,ocr,out,raw,changes):
    gray=np.array(frame);candidates=[]
    for s in systems:
        si=s['systemIndex'];sp=s['spacing'];top,bottom=s['lines'][0],s['lines'][-1];mid=(top+bottom)/2
        # Remove only long horizontal strokes in this OCR working mask, retain original crops.
        ink=(gray<160).astype(np.uint8);h=cv2.morphologyEx(ink,cv2.MORPH_OPEN,np.ones((1,max(5,int(sp*5))),np.uint8));clean=ink-h
        band=clean[max(0,int(top)):int(bottom)+1,int(s['bounds'][0]):int(s['bounds'][2])+1]
        projection=np.sum(band,axis=0);active=np.flatnonzero(projection>sp*.45);runs=[]
        for x in active:
            if runs and x-runs[-1][-1]<=max(2,int(sp*.25)):runs[-1].append(x)
            else:runs.append([x])
        for ri,run in enumerate(runs):
            x0=run[0]+int(s['bounds'][0]);x1=run[-1]+int(s['bounds'][0])+1
            if not .5*sp<=x1-x0<=2.1*sp:continue
            x=(x0+x1)/2
            # A meter must be before notes in a physical interval, not on a notehead column.
            overlap=[g for g in s['symbols'] if g['type']=='Note' and abs(g['center'][0]-x)<.9*sp]
            if overlap:continue
            hits=[r for r in regions if r['status']=='physical-candidate' and r['measure']['systemIndex']==si and r['box'][0]<x<r['box'][2]]
            if len(hits)!=1:continue
            region=hits[0];anchors=[links[id]['geometry']['center'][0] for id in region['anchorEventIds']]
            if anchors and x>min(anchors):continue
            upper=clean[int(top):int(mid),x0:x1];lower=clean[int(mid):int(bottom)+1,x0:x1]
            if upper.sum()<sp*2 or lower.sum()<sp*2:continue
            reads=[];pair=[]
            for half,(ya,yb) in enumerate([(top,mid),(mid,bottom+1)]):
                box=[max(0,x0-2),max(0,int(ya)-1),min(frame.width,x1+2),min(frame.height,int(yb)+1)]
                image=save_crop(frame,box,out/'ocr-meter',f's{si}-r{ri}-h{half}',scale=6)
                for oem in [1,0]:
                    for psm in [10,13]:
                        words=ocr.recognize(image,psm=psm,oem=oem,whitelist='0123456789');reads.append({'half':half,'psm':psm,'oem':oem,'words':words})
                values=[w['text'] for r in reads if r['half']==half for w in r['words'] if w['text'].isdigit() and w['confidence']>=20]
                pair.append(values[0] if len(values)>=2 and len(set(values))==1 else None)
            source_box=[x0-2,int(top)-1,x1+2,int(bottom)+2]
            raw.append({'feature':'meter','systemIndex':si,'sourceBox':source_box,'reads':reads})
            row={'feature':'meter','systemIndex':si,'sourceBox':source_box,'read':pair,'measureIndex':region['measure']['measureIndex'],'status':'unresolved','evidence':['stacked glyphs before notes inside corroborated physical interval','two OCR segmentation hypotheses for each digit']}
            if all(pair) and 1<=int(pair[0])<=16 and int(pair[1]) in [1,2,4,8,16]:
                m=measures[row['measureIndex']];old=[ET.tostring(n,encoding='unicode') for n in m['element'].findall('attributes/time')]
                attr=m['element'].find('attributes')
                if attr is None:attr=ET.Element('attributes');m['element'].insert(0,attr)
                for a in m['element'].findall('attributes'):
                    for t in a.findall('time'):a.remove(t)
                t=ET.SubElement(attr,'time');ET.SubElement(t,'beats').text=pair[0];ET.SubElement(t,'beat-type').text=pair[1]
                row['status']='applied-candidate';row['noteDurationsChanged']=False
                changes.append({'feature':'meter','measureId':m['id'],'before':old,'after':ET.tostring(t,encoding='unicode'),'sourceBox':source_box,'source':'original stacked numerals + local OCR','evidence':row['evidence'],'reviewRequired':True,'durationNormalization':False})
            else:row['reason']='paired numeral OCR lacks agreement or supported numerical value'
            candidates.append(row)
    return candidates

def slashes(frame,systems,measures,events,links,regions,out,changes):
    gray=np.array(frame);ink=(gray<160).astype(np.uint8);candidates=[]
    for s in systems:
        si=s['systemIndex'];sp=s['spacing'];mid=s['lines'][2];left,right=int(s['bounds'][0]),int(s['bounds'][2]);top=max(0,int(s['lines'][0]-3*sp));bottom=min(frame.height,int(s['lines'][-1]+1.5*sp))
        h=cv2.morphologyEx(ink,cv2.MORPH_OPEN,np.ones((1,max(5,int(sp*5))),np.uint8))
        band=(ink-h)[top:bottom,left:right]*255
        # Edge segments avoid the voting suppression caused by long horizontal staff lines.
        lines=cv2.createLineSegmentDetector().detect(gray[top:bottom,left:right])[0]
        diagonal=[]
        if lines is None:continue
        for x0,y0,x1,y1 in lines[:,0]:
            dx=x1-x0;dy=y1-y0
            if dx==0 or dx*dy>=0:continue
            angle=math.degrees(math.atan2(abs(dy),abs(dx)));length=math.hypot(dx,dy);cx=(x0+x1)/2+left;cy=(y0+y1)/2+top
            if 48<=angle<=72 and 1.55*sp<=length<=3.0*sp:diagonal.append((cx,cy,[int(x0+left),int(y0+top),int(x1+left),int(y1+top)],angle))
        groups=[]
        for item in sorted(diagonal):
            group=next((g for g in groups if abs(item[0]-np.mean([a[0] for a in g]))<.7*sp and abs(item[1]-np.mean([a[1] for a in g]))<.7*sp),None)
            if group is not None:group.append(item)
            else:groups.append([item])
        # A repeated consistent diagonal row supplies symbol evidence absent from homr's notehead class.
        if len(groups)<2:continue
        for gi,group in enumerate(groups):
            cx=float(np.mean([g[0] for g in group]));cy=float(np.mean([g[1] for g in group]));box=[cx-.8*sp,cy-1.35*sp,cx+.8*sp,cy+1.35*sp]
            if sum(abs(cy-np.mean([p[1] for p in g]))<.7*sp for g in groups)<2:continue
            crop=gray[max(0,int(cy-sp)):int(cy+sp),max(0,int(cx-.7*sp)):int(cx+.7*sp)];ys,xs=np.where(crop<160)
            ratio=0;angle=0
            if len(xs)>4:
                vals,vecs=np.linalg.eigh(np.cov(np.array([xs,ys])));ratio=float(vals[-1]/max(vals[0],.001));axis=vecs[:,-1];angle=math.degrees(math.atan2(abs(axis[1]),abs(axis[0])))
            hits=[];retained=[]
            for e in events:
                row=links[e['id']];a=row.get('attentionEstimate')
                if e['systemIndex']==si and e['kind']=='note' and a and abs(a[0]-cx)<1.2*sp and abs(a[1]-cy)<2*sp:
                    if row['status']=='physical-candidate':retained.append(e['id'])
                    else:hits.append(e)
            row={'feature':'rhythm-slash','systemIndex':si,'sourceBox':box,'lines':[g[2] for g in group],'shape':{'pcaRatio':ratio,'angle':angle},'candidateEventIds':[e['id'] for e in hits],'retainedPhysicalPitchedEventIds':retained,'status':'unresolved','evidence':['original pixel diagonals, repeated row','homr attention only supplies candidate neighbourhood','independently corroborated pitched glyphs excluded from replacement']}
            # Observe a stem and one beam in the original pixels; do not infer duration from bar capacity.
            xstem=int(max(max(g[2][0],g[2][2]) for g in group));y_end=int(min(min(g[2][1],g[2][3]) for g in group))
            origin=max(0,int(y_end-4*sp))
            patch=ink[origin:max(0,y_end),max(0,int(xstem-2.4*sp)):min(frame.width,int(xstem+2.4*sp))]
            beam_rows=np.flatnonzero(patch.sum(axis=1)>2.1*sp);bands=[]
            for y in beam_rows:
                if bands and y-bands[-1][-1]<=2:bands[-1].append(int(y))
                else:bands.append([int(y)])
            # Exclude the five staff lines from beam evidence.
            bands=[b for b in bands if all(abs(origin+np.mean(b)-line)>.28*sp for line in s['lines'])]
            row['sourceBeamBands']=[[origin+b[0],origin+b[-1]] for b in bands]
            coverage=0
            if len(bands)==1:
                stem=ink[origin+bands[0][-1]:y_end,max(0,int(xstem-.6*sp)):int(xstem+.6*sp)+1]
                if stem.size:coverage=float(stem.mean(axis=0).max())
            row['sourceStemCoverage']=coverage
            if len(hits)==1 and ratio>=2.4 and 48<=angle<=75 and len(bands)==1 and coverage>=.8:
                e=hits[0];region=next((r for r in regions if r['measure']['measureIndex']==e['measureIndex'] and r['status']=='physical-candidate' and r['box'][0]<cx<r['box'][2]),None)
                row['voice']=e['voice'];row['homrDuration']=e['duration']
                if region and F(e['duration'])==F(1,2) and not e['hasCurve'] and e['element'].find('lyric') is None:
                    n=e['element'];before=ET.tostring(n,encoding='unicode')
                    for child in list(n):
                        if child.tag in ['pitch','accidental']:n.remove(child)
                    un=ET.Element('unpitched');ET.SubElement(un,'display-step').text='B';ET.SubElement(un,'display-octave').text='4'
                    n.insert(next((i for i,c in enumerate(n) if c.tag not in ['grace','cue','chord']),len(n)),un)
                    nh=n.find('notehead')
                    if nh is None:
                        nh=ET.Element('notehead');n.insert(next((i for i,c in enumerate(n) if c.tag in ['staff','beam','notations','lyric','play']),len(n)),nh)
                    nh.text='slash';row.update(status='applied-candidate',eventId=e['id'],durationEvidence='one source beam and connecting stem agree with homr eighth; no bar-length repair',curvePolicy='events with existing tie/slur are withheld; original image connections are not recognized and remain unresolved')
                    changes.append({'feature':'rhythm-slash','eventIds':[e['id']],'sourceBox':box,'source':'source diagonal/beam pixels + exact homr token trace','before':before,'after':ET.tostring(n,encoding='unicode'),'evidence':row['evidence']+['unique model event in physical interval','one source beam agrees with eighth duration'],'reviewRequired':True,'pitchUnspecified':True})
                else:row['reason']='measure, duration, curve or lyric relationship unresolved'
            else:row['reason']='shape, unique event or beam evidence insufficient'
            candidates.append(row)
    write(out/'slash-pixel-candidates.json',candidates)
    return candidates
