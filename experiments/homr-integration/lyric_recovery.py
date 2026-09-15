"""Raster-grounded lyric recovery; no score reference or language completion.

Only lyric elements can change. Existing lyrics require exact automatic history
before replacement; all new values remain review-required hypotheses.
"""
from collections import Counter, defaultdict
from statistics import median
from fractions import Fraction
from xml.etree import ElementTree as ET
import re, unicodedata
import numpy as np
from PIL import Image, ImageOps

VERSION = 'hm-lyric-recovery-v1'


def detect_rows(frame, system, next_top=None):
    sp=system['spacing'];x0=max(0,int(system['bounds'][0]));x1=min(frame.width,int(system['bounds'][2]))
    y0=max(0,int(system['lines'][-1]+.6*sp));y1=min(frame.height,int(system['lines'][-1]+9*sp),int(next_top or frame.height))
    if y1<=y0:return []
    ink=np.asarray(frame.crop((x0,y0,x1,y1)))<140
    for density in (.025,.008):
        active=ink.sum(axis=1)>=max(5,(x1-x0)*density);runs=[]
        for y,on in enumerate(active):
            if on and (not runs or y>runs[-1][-1]+2):runs.append([y])
            elif on:runs[-1].append(y)
        # Sparse lyrics need a lower population threshold, not a shorter font.
        boxes=[[x0,max(y0,y0+r[0]-2),x1,min(y1,y0+r[-1]+3)]for r in runs
               if 1.2*sp<=r[-1]-r[0]+1<=3*sp]
        if boxes:return boxes
    return []


def source_box(box, crop, scale, padding=12):
    return [(box[0]-padding)/scale+crop[0],(box[1]-padding)/scale+crop[1],
            (box[2]-padding)/scale+crop[0],(box[3]-padding)/scale+crop[1]]


def read_row(frame,box,ocr,language,raw,si):
    crop=frame.crop(box);reads=[]
    # Language selection is the user's OCR setting, never a song dictionary.
    langs=[language]
    if 'kor' in language and 'eng' in language:
        probe=ImageOps.expand(crop.resize((crop.width*3,crop.height*3)),12,255)
        words=ocr.recognize(probe,language=language,psm=7)
        text=''.join(w['text']for w in words)
        korean=len(re.findall(r'[가-힣]',text));latin=len(re.findall(r'[A-Za-z]',text))
        primary='eng'if latin>3*korean and latin>=4 else 'kor'
        langs=[primary,language]
    for lang,scale,preparation in [(langs[0],3,'intact'),(langs[0],4,'intact'),(langs[0],3,'ink-180')]+([(langs[1],3,'intact')]if len(langs)>1 else []):
        pixels=crop.point(lambda p:0 if p<180 else 255)if preparation=='ink-180'else crop
        image=ImageOps.expand(pixels.resize((crop.width*scale,crop.height*scale),Image.Resampling.BICUBIC),12,255)
        words=ocr.recognize(image,language=lang,psm=7)
        symbols=ocr.recognize(image,language=lang,psm=7,symbols=True)
        units=[]
        for w in words:
            text=unicodedata.normalize('NFC',w['text'])
            if re.search(r'[가-힣]',text):
                for u in symbols:
                    if re.fullmatch(r'[가-힣]',u['text']) and u['box'][0]>=w['box'][0]-2 and u['box'][2]<=w['box'][2]+2:
                        units.append({'text':unicodedata.normalize('NFC',u['text']),'confidence':min(w['confidence'],u['confidence']),'sourceBox':source_box(u['box'],box,scale)})
            elif re.fullmatch(r'[A-Za-z]+',text):
                units.append({'text':text,'confidence':w['confidence'],'sourceBox':source_box(w['box'],box,scale)})
        record={'feature':'lyric-recovery','systemIndex':si,'sourceBox':box,'language':lang,'oem':1,'psm':7,'preparation':preparation,'transform':{'scale':scale,'padding':12},'words':words,'symbols':symbols}
        raw.append(record);reads.append(units)
    return reads


def elect_units(reads,spacing):
    """Correlated re-reads are explicit, and every conflict remains evidence."""
    groups=[]
    for ri,units in enumerate(reads):
        for u in units:
            b=u['sourceBox'];x=(b[0]+b[2])/2
            g=next((g for g in groups if abs(g['x']-x)<.55*spacing and ri not in [v['read']for v in g['reads']]),None)
            if g is None:g={'x':x,'reads':[]};groups.append(g)
            g['reads'].append({**u,'read':ri})
    result=[]
    for g in sorted(groups,key=lambda g:g['x']):
        votes=defaultdict(list)
        for u in g['reads']:
            if u['confidence']>=70:votes[u['text']].append(u)
        ranked=sorted(votes,key=lambda t:len(votes[t]),reverse=True)
        text=ranked[0] if ranked and len(votes[ranked[0]])>=2 and (len(ranked)==1 or len(votes[ranked[0]])>len(votes[ranked[1]]))else None
        selected=votes[text]if text else g['reads']
        result.append({'text':text,'sourceBox':[median(u['sourceBox'][i]for u in selected)for i in range(4)],'reads':g['reads'],'readSupport':len(votes[text])if text else 0,'recognitionStatus':'corroborated-candidate'if text else 'unresolved'})
    return result


def attach_units(units,system,links,physical,events):
    sp=system['spacing'];si=system['systemIndex'];em={e['id']:e for e in events}
    anchors=[]
    for id,l in links.items():
        if l['status']=='physical-candidate' and l['event']['systemIndex']==si and id in em:
            anchors.append((l['geometry']['center'][0],em[id]))
    for u in units:
        b=u['sourceBox'];x=(b[0]+b[2])/2
        options=sorted([(abs(ax-x)/sp,e)for ax,e in anchors if abs(ax-x)<=.5*sp],key=lambda v:v[0])
        u['attachmentOptions']=[{'eventId':e['id'],'distanceSpaces':d}for d,e in options]
        u['status']='unresolved'
        if not u.get('text'):u['reason']='text recognition conflict';continue
        if not options or (len(options)>1 and options[1][0]-options[0][0]<.35):u['reason']='competing or missing glyph columns';continue
        e=options[0][1];p=physical.get(f"p{e['partIndex']}m{e['measureIndex']}",{})
        if not p.get('supported') or not p['sourceBox'][0]<x<p['sourceBox'][2]:u['reason']='physical interval coverage unresolved';continue
        if e['kind']!='note' or e['element'].find('tie[@type="stop"]') is not None:u['reason']='rest, rhythm or tie continuation';continue
        u.update(eventId=e['id'],voice=e['voice'],status='supported-candidate',evidence=['source-pixel lyric row','exact raw token to pitch-agreeing glyph','physical interval coverage','centered text/glyph overlap and competing-column margin'])
        # Partially overlapping OCR boxes can be fragments of a larger glyph.
        # Do not let a narrow fragment claim an adjacent attack.
        for other in units:
            if other is u:continue
            ob=other['sourceBox'];overlap=max(0,min(b[2],ob[2])-max(b[0],ob[0]))
            if overlap>min(b[2]-b[0],ob[2]-ob[0])*.5 and u.get('readSupport',0)<3:
                u.update(status='unresolved',reason='overlapping OCR symbol segmentation');break
    # A second token may not steal the same attack; sequence must be monotonic.
    counts=Counter(u.get('eventId')for u in units if u['status']=='supported-candidate')
    for u in units:
        if u['status']=='supported-candidate' and counts[u['eventId']]>1:u.update(status='unresolved',reason='multiple printed tokens compete for one attack')
    selected=[u for u in units if u['status']=='supported-candidate']
    for a,b in zip(selected,selected[1:]):
        ea,eb=em[a['eventId']],em[b['eventId']]
        if ea['voice']==eb['voice'] and (ea['measureIndex'],Fraction(ea['onset'])) >= (eb['measureIndex'],Fraction(eb['onset'])):
            for u in (a,b):u.update(status='unresolved',reason='printed order contradicts event order')
    return units


def recover(frame,systems,events,links,timeline,ocr,raw,changes,language='eng+kor',regions=()):
    physical=dict(timeline.get('physicalIntervals',{}));em={e['id']:e for e in events};records=[];plans=[]
    for r in regions:
        if r['status']=='physical-candidate' and not physical.get(r['measure']['id'],{}).get('supported'):
            physical[r['measure']['id']]={'supported':True,'sourceBox':r['box'],'scope':'original multi-anchor barline interval; completeness not asserted'}
    for i,s in enumerate(systems):
        boxes=detect_rows(frame,s,systems[i+1]['lines'][0]-5*s['spacing']if i+1<len(systems)else None)
        for ri,box in enumerate(boxes):
            # Staff-relative search is broad enough for close-set lyrics, but
            # a row crossing actual source noteheads is musical ink, not verse.
            if any(l.get('geometry') and l['event']['systemIndex']==s['systemIndex']
                   and box[1]<=l['geometry']['center'][1]<=box[3] for l in links.values()):
                records.append({'feature':'lyric','status':'unresolved','reason':'candidate row overlaps source notehead glyphs','systemIndex':s['systemIndex'],'sourceBox':box,'recoveryVersion':VERSION,'reviewRequired':True});continue
            units=elect_units(read_row(frame,box,ocr,language,raw,s['systemIndex']),s['spacing'])
            plans.append((s,boxes,ri,box,units))
    visual_corroborate(frame,[u for _,_,_,_,us in plans for u in us])
    row_numbers={};counts=Counter()
    for s,boxes,ri,box,units in plans:
        if sum(bool(u.get('text'))for u in units)>=2:
            counts[s['systemIndex']]+=1;row_numbers[(s['systemIndex'],ri)]=str(counts[s['systemIndex']])
    for s,boxes,ri,box,units in plans:
            units=attach_units(units,s,links,physical,events)
            for u in units:
                verse=row_numbers.get((s['systemIndex'],ri))
                u.update(feature='lyric',systemIndex=s['systemIndex'],spatialLineIndex=ri,rowBox=box,recoveryVersion=VERSION,verse=verse,verseStatus='physical row ordinal; internal verse number, not printed label',extendStatus='not inferred',reviewRequired=True)
                if verse is None:u.update(status='unresolved',reason='insufficient text evidence for a lyric row')
                if u['status']=='supported-candidate':
                    e=em[u['eventId']];n=e['element'];existing=n.findall('lyric[@number="'+verse+'"]')
                    if any(l.get('number')is None for l in n.findall('lyric')):
                        u.update(status='unresolved',reason='existing unnumbered verse ambiguity');records.append(u);continue
                    if existing:
                        automatic=next((c for c in reversed(changes) if c.get('feature')in ('lyric','lyric-recovery') and c.get('eventIds')==[e['id']]),None)
                        before=ET.tostring(existing[0],encoding='unicode')if len(existing)==1 else None
                        if before and automatic and automatic['after']==before and existing[0].findtext('text')!=u['text'] and u['readSupport']>=2:
                            existing[0].find('text').text=u['text'];after=ET.tostring(existing[0],encoding='unicode')
                            changes.append({'feature':'lyric-recovery','ruleVersion':VERSION,'before':before,'after':after,'eventIds':[e['id']],'sourceBox':u['sourceBox'],'source':VERSION,'evidence':u['evidence'],'reviewRequired':True})
                            u.update(status='applied-candidate',before=before)
                        else:u.update(status='preserved-existing',reason='existing lyrics retained; no user correction overwritten')
                    else:
                        other_verse=n.find('lyric')is not None
                        lyric=ET.SubElement(n,'lyric',number=verse);ET.SubElement(lyric,'syllabic').text='single';ET.SubElement(lyric,'text').text=u['text']
                        u['status']='applied-candidate'
                        changes.append({'feature':'lyric-verse'if other_verse else 'lyric','ruleVersion':VERSION,'before':None,'after':ET.tostring(lyric,encoding='unicode'),'eventIds':[u['eventId']],'sourceBox':u['sourceBox'],'source':VERSION,'evidence':u['evidence']+['distinct physical lyric row'],'reviewRequired':True})
                records.append(u)
    recover_extensions(frame,systems,events,links,records,changes)
    return records,{'version':VERSION,'runtimeReferenceUsed':False,'policy':'raster/OCR candidates; explicit user lyrics preserved; exact automatic lyric history required for replacement; no language completion; correlated OCR readings not independent confidence; verse and extend ambiguity deferred'}


def visual_corroborate(frame,units):
    """Compare current-raster repeated glyphs, without any saved text templates.

    A label needs multiple directly read source locations and an actual OCR
    alternative at the target. Similarity cannot supply an unseen character.
    """
    shapes={};seeds=defaultdict(list)
    for i,u in enumerate(units):
        image=frame.crop(tuple(int(round(v))for v in u['sourceBox'])).point(lambda p:255 if p<160 else 0)
        box=image.getbbox()
        if not box:continue
        image=image.crop(box);shapes[i]=(image.width/image.height,np.asarray(image.resize((32,32),Image.Resampling.BILINEAR),dtype=float)/255)
        if u.get('text') and len(u['text'])==1 and u.get('readSupport',0)>=3 and min(r['confidence']for r in u['reads']if r['text']==u['text'])>=80:
            seeds[u['text']].append(i)
    for i,u in enumerate(units):
        if i not in shapes or u.get('text'):continue
        options=[];ratio,pixels=shapes[i]
        actual={r['text']for r in u['reads']if r['confidence']>=60}
        for text,indices in seeds.items():
            scores=[]
            for j in indices:
                if j==i or abs(units[j]['sourceBox'][0]-u['sourceBox'][0])+abs(units[j]['sourceBox'][1]-u['sourceBox'][1])<10:continue
                r,a=shapes[j]
                if abs(r-ratio)>.18:continue
                scores.append((float(np.mean(np.abs(a-pixels))),j))
            scores.sort()
            if len(scores)>=2:options.append((scores[1][0],text,scores[:2]))
        options.sort();u['visualAlternatives']=[{'text':t,'secondDistance':d,'sourceBoxes':[units[j]['sourceBox']for _,j in score]}for d,t,score in options[:3]]
        if options and options[0][0]<=.16 and (len(options)==1 or options[1][0]-options[0][0]>=.035)and options[0][1]in actual:
            u.update(text=options[0][1],recognitionStatus='OCR plus repeated source glyphs',visualCorroborated=True)


def recover_extensions(frame,systems,events,links,records,changes):
    """A printed horizontal continuation mark AND a complete valid tie edge.

    Missing OCR alone never licenses a continuation. We do not infer across
    system breaks, ambiguous voices, rests, unpaired curves or fresh attacks.
    """
    import cv2
    em={e['id']:e for e in events};byvoice=defaultdict(list)
    for e in events:byvoice[(e['partIndex'],e['voice'])].append(e)
    for r in records:
        if r['status']not in ('applied-candidate','preserved-existing'):continue
        e=em[r['eventId']];n=e['element'];l=n.find('lyric')
        if l is None or l.find('extend')is not None or l.findtext('text')!=r['text']or n.find('tie[@type="start"]')is None:continue
        voice=byvoice[(e['partIndex'],e['voice'])];index=voice.index(e)
        if index+1>=len(voice):continue
        end=voice[index+1];en=end['element']
        pitch=lambda n:tuple(n.findtext('pitch/'+k,'0'if k=='alter'else '')for k in ('step','alter','octave'))
        if end['systemIndex']!=e['systemIndex']or end['measureIndex']!=e['measureIndex']or end['kind']!='note' or en.find('tie[@type="stop"]')is None or en.find('lyric')is not None or pitch(n)!=pitch(en):continue
        if Fraction(e['onset'])+Fraction(e['duration'])!=Fraction(end['onset']):continue
        link=links[end['id']]
        if link['status']!='physical-candidate':continue
        s=next(s for s in systems if s['systemIndex']==e['systemIndex']);sp=s['spacing'];rb=r['rowBox'];b=r['sourceBox']
        x0=int(b[2]+1);x1=min(frame.width,int(link['geometry']['center'][0]+sp));y0=int(rb[1]);y1=int(rb[3])
        if x1<=x0:continue
        mask=(np.asarray(frame.crop((x0,y0,x1,y1)))<140).astype('uint8')
        _,_,stats,_=cv2.connectedComponentsWithStats(mask,8);marks=[]
        for x,y,w,h,area in stats[1:]:
            if .4*sp<=w<=1.8*sp and 1<=h<=.45*sp and w>=2*h and abs(y+h/2-mask.shape[0]/2)<=sp*.6:
                marks.append([int(x0+x),int(y0+y),int(x0+x+w),int(y0+y+h)])
        if not marks:continue
        before=ET.tostring(l,encoding='unicode');automatic=next((c for c in reversed(changes)if c.get('feature')in ('lyric','lyric-recovery')and c.get('eventIds')==[e['id']]),None)
        if not automatic or automatic['after']!=before:continue
        ET.SubElement(l,'extend');after=ET.tostring(l,encoding='unicode')
        changes.append({'feature':'lyric-recovery','ruleVersion':VERSION,'before':before,'after':after,'eventIds':[e['id']],'sourceBox':marks[0],'source':VERSION,'evidence':['printed horizontal continuation mark','paired same-pitch same-voice contiguous tie','no new lyric attack at continuation'],'reviewRequired':True})
        r['extendStatus']='derived from printed mark and complete tie; not tie alone';r['extendEvidence']={'markBoxes':marks,'startEventId':e['id'],'endEventId':end['id']}
