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

VERSION = 'hm-lyric-recovery-v1.1'


def tighten_symbol_boxes(image, symbols):
    """Keep recognized labels; trim overlapping LSTM boxes at a real ink gap.

    Korean result-iterator boxes can cover the following character. Its next
    independently returned left edge bounds the search, but a blank column
    run in the actual raster must support the split. No equal-width division.
    """
    ink=np.asarray(image)<200;result=[]
    for i,u in enumerate(symbols):
        v=dict(u);x0,y0,x1,y1=u['box'];h=y1-y0
        if re.fullmatch(r'[가-힣]',u['text'])and i+1<len(symbols):
            nx=symbols[i+1]['box'][0]
            if x0+.4*h<nx<x1 and h>0:
                lo=max(x0+1,int(nx-.55*h));hi=min(image.width,int(nx+.08*h)+1)
                empty=~ink[max(0,y0):min(image.height,y1),lo:hi].any(axis=0);runs=[]
                for j,on in enumerate(empty):
                    if on and (not runs or j>runs[-1][-1]+1):runs.append([j])
                    elif on:runs[-1].append(j)
                if runs:
                    gap=max(runs,key=lambda r:len(r));cut=lo+gap[len(gap)//2]
                    if cut>x0+.4*h:
                        area=ink[max(0,y0):min(image.height,y1),max(0,x0):cut]
                        ys,xs=np.nonzero(area)
                        if len(xs):
                            v['rawBox']=u['box'];v['box']=[x0+int(xs.min()),y0+int(ys.min()),x0+int(xs.max())+1,y0+int(ys.max())+1]
                            v['boxEvidence']={'rule':'next OCR symbol start plus actual blank ink columns','gap':[lo+gap[0],lo+gap[-1]+1]}
        result.append(v)
    return result


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
        raw_symbols=ocr.recognize(image,language=lang,psm=7,symbols=True)
        symbols=tighten_symbol_boxes(image,raw_symbols)
        units=[]
        for w in words:
            text=unicodedata.normalize('NFC',w['text'])
            if re.search(r'[가-힣]',text):
                for u in symbols:
                    if re.fullmatch(r'[가-힣]',u['text']) and u['box'][0]>=w['box'][0]-2 and u['box'][2]<=w['box'][2]+2:
                        units.append({'text':unicodedata.normalize('NFC',u['text']),'confidence':min(w['confidence'],u['confidence']),'sourceBox':source_box(u['box'],box,scale)})
            elif re.fullmatch(r'[A-Za-z]+',text):
                units.append({'text':text,'confidence':w['confidence'],'sourceBox':source_box(w['box'],box,scale)})
            elif re.fullmatch(r'[A-Za-z]+_+',text):
                # OCR sometimes concatenates the actual printed melisma line
                # to a word. Remove no arbitrary punctuation: verify its ink.
                prefix=text.rstrip('_')
                letters=[u for u in symbols if re.fullmatch(r'[A-Za-z]',u['text'])and w['box'][0]<=u['box'][0] and u['box'][2]<=w['box'][2]]
                if ''.join(u['text']for u in letters)!=prefix:continue
                x0=min(u['box'][0]for u in letters);x1=max(u['box'][2]for u in letters);y0=min(u['box'][1]for u in letters);y1=max(u['box'][3]for u in letters)
                # Leave the subpixel resize fringe of the final letter out of
                # the following-line measurement, not out of its lyric box.
                line_start=min(w['box'][2],x1+max(1,int(.1*(y1-y0))))
                line=np.asarray(image.crop((line_start,y0,w['box'][2],y1)))<175
                ys,xs=np.nonzero(line)
                if len(xs)and xs.max()-xs.min()>1.5*(y1-y0)and ys.max()-ys.min()<=.25*(y1-y0):
                    units.append({'text':prefix,'confidence':min(u['confidence']for u in letters),'sourceBox':source_box([x0,y0,x1,y1],box,scale),'segmentationEvidence':'raw Latin symbols followed by an actual long thin raster line'})
        record={'feature':'lyric-recovery','systemIndex':si,'sourceBox':box,'language':lang,'oem':1,'psm':7,'preparation':preparation,'transform':{'scale':scale,'padding':12},'words':words,'symbols':symbols,'symbolBoxRule':'source-gap-v1'}
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
    latin_row=sum(bool(re.fullmatch(r'[A-Za-z]{2,}',u.get('text')or ''))for u in units)>3*sum(bool(re.search(r'[가-힣]',u.get('text')or ''))for u in units)
    anchors=[]
    for id,l in links.items():
        if l['status']=='physical-candidate' and l['event']['systemIndex']==si and id in em:
            anchors.append((l['geometry']['center'][0],em[id]))
    for u in units:
        b=u['sourceBox'];x=(b[0]+b[2])/2
        word=latin_row and bool(re.fullmatch(r'[A-Za-z]{2,}',u.get('text')or ''))
        options=sorted([(0 if word and b[0]<=ax<=b[2]else abs(ax-x)/sp,e)for ax,e in anchors if (word and b[0]<=ax<=b[2])or abs(ax-x)<=.5*sp],key=lambda v:v[0])
        u['attachmentOptions']=[{'eventId':e['id'],'distanceSpaces':d}for d,e in options]
        u['status']='unresolved'
        if not u.get('text'):u['reason']='text recognition conflict';continue
        if b[3]-b[1]<.8*sp:u['reason']='text box lacks full-height character ink';continue
        if not options or (len(options)>1 and options[1][0]-options[0][0]<.35):u['reason']='competing or missing glyph columns';continue
        e=options[0][1];p=physical.get(f"p{e['partIndex']}m{e['measureIndex']}",{})
        if not p.get('supported') or not p['sourceBox'][0]<x<p['sourceBox'][2]:u['reason']='physical interval coverage unresolved';continue
        if e['kind']!='note' or e['element'].find('tie[@type="stop"]') is not None:u['reason']='rest, rhythm or tie continuation';continue
        u.update(eventId=e['id'],voice=e['voice'],wordBoxAttachment=word,status='supported-candidate',evidence=['source-pixel lyric row','exact raw token to pitch-agreeing glyph','physical interval coverage','centered text/glyph overlap and competing-column margin'])
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
                        # A word box containing a unique note licenses a new
                        # attachment, not replacement of an existing reading.
                        # Repeated OCR on that same word is correlated evidence.
                        if before and automatic and automatic['after']==before and existing[0].findtext('text')!=u['text'] and u['readSupport']>=2 and not u.get('wordBoxAttachment'):
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
    recover_cells(frame,plans,row_numbers,events,links,ocr,raw,records,changes)
    recover_extensions(frame,systems,events,links,records,changes)
    recover_printed_extensions(frame,systems,events,links,records,changes)
    return records,{'version':VERSION,'runtimeReferenceUsed':False,'policy':'raster/OCR candidates; explicit user lyrics preserved; exact automatic lyric history required for replacement; no language completion; correlated OCR readings not independent confidence; verse and extend ambiguity deferred'}


def recover_cells(frame,plans,row_numbers,events,links,ocr,raw,records,changes):
    """Re-read actual ink inside independently known note-column boundaries.

    This does not distribute a word over notes. Every cell must contain an
    intact, isolated printed glyph, two fresh OCR reads and a matching raw
    row symbol. Unknown columns, clipped ink, rests and ties remain guarded.
    """
    if ocr is None:return  # Pure contract fixtures may supply pre-read row units.
    em={e['id']:e for e in events}
    for s,boxes,ri,row,units in plans:
        verse=row_numbers.get((s['systemIndex'],ri))
        if verse is None:continue
        sp=s['spacing'];anchors=sorted([(l['geometry']['center'][0],em[id])for id,l in links.items()if id in em and l.get('status')=='physical-candidate'and l['event']['systemIndex']==s['systemIndex']],key=lambda t:t[0])
        raw_rows=[r for r in raw if r.get('feature')=='lyric-recovery' and r.get('sourceBox')==row and 'symbols'in r]
        for i,(x,e) in enumerate(anchors):
            if e['kind']!='note':continue
            left=anchors[i-1][0]if i else x-3*sp;right=anchors[i+1][0]if i+1<len(anchors)else x+3*sp
            if x-left<1.3*sp or right-x<1.3*sp:continue
            x0=max(0,int(max(x-1.7*sp,(left+x)/2)));x1=min(frame.width,int(min(x+1.7*sp,(right+x)/2)))
            y0=max(0,int(row[1])-2);y1=min(frame.height,int(row[3])+2)
            pixels=np.asarray(frame.crop((x0,y0,x1,y1)));mask=(pixels<175).astype('uint8');ys,xs=np.nonzero(mask)
            if not len(xs):continue
            n=e['element'];lyric=n.find('lyric[@number="'+verse+'"]');before=ET.tostring(lyric,encoding='unicode')if lyric is not None else None
            automatic=next((c for c in reversed(changes)if c.get('feature')in ('lyric','lyric-recovery','lyric-verse')and c.get('eventIds')==[e['id']]and c.get('after')==before),None)if before else None
            height=int(ys.max()-ys.min()+1);width=int(xs.max()-xs.min()+1)
            cell=[x0,y0,x1,y1];inkbox=[x0+int(xs.min()),y0+int(ys.min()),x0+int(xs.max())+1,y0+int(ys.max())+1]
            # A printed continuation dash cannot also be a printed syllable.
            if automatic and height<=.45*sp and .35*sp<=width<=2*sp and width>=2*height and i and anchors[i-1][1]['voice']==e['voice']:
                previous=anchors[i-1][1]
                oldbox=automatic.get('sourceBox')
                printed_attack=previous['element'].find('lyric[@number="'+verse+'"]')is not None
                same_thin_box=oldbox and oldbox[3]-oldbox[1]<=.5*sp
                if previous['measureIndex']==e['measureIndex']and (printed_attack or same_thin_box)and Fraction(previous['onset'])+Fraction(previous['duration'])==Fraction(e['onset']):
                    n.remove(lyric)
                    changes.append({'feature':'lyric-retraction','ruleVersion':VERSION,'before':before,'after':None,'eventIds':[e['id']],'sourceBox':inkbox,'source':VERSION,'evidence':['exact automatic lyric history','source endpoint cell contains only a printed horizontal mark','preceding printed lyric or original OCR box also has only line height','same-voice adjacent columns and contiguous time'],'reviewRequired':True})
                    records.append({'feature':'lyric','recoveryVersion':VERSION,'eventId':e['id'],'status':'withheld-candidate','sourceBox':inkbox,'reason':'automatic lyric was read from a printed continuation mark','before':before,'reviewRequired':True})
                continue
            if n.find('tie[@type="stop"]')is not None:continue
            if not (.9*sp<=height<=3*sp and .4*height<=width<=1.4*height):continue
            if xs.min()==0 or xs.max()==mask.shape[1]-1:continue
            if before and not automatic:continue
            # Guard against the notehead/upper-score-ink row seen in legacy C.
            if row[1]<=s['lines'][-1]+.7*sp:continue
            crop=ImageOps.expand(frame.crop(cell).resize(((x1-x0)*4,(y1-y0)*4),Image.Resampling.BICUBIC),16,255)
            reads=[ocr.recognize(crop,language='kor',psm=psm)for psm in (8,10,13)]
            labels=[''.join(r['text']for r in rs)for rs in reads]
            raw.append({'feature':'lyric-cell','systemIndex':s['systemIndex'],'eventId':e['id'],'sourceBox':cell,'inkBox':inkbox,'language':'kor','psm':[8,10,13],'scale':4,'padding':16,'reads':reads})
            votes=Counter(label for label,rs in zip(labels,reads)if re.fullmatch(r'[가-힣]',label)and rs and min(r['confidence']for r in rs)>=50)
            if not votes:continue
            text,count=votes.most_common(1)[0]
            if count<2 or not any(label==text and rs and min(r['confidence']for r in rs)>=85 for label,rs in zip(labels,reads)):continue
            support=[]
            for qi,q in enumerate(raw_rows):
                for u in q['symbols']:
                    b=source_box(u.get('rawBox',u['box']),row,q['transform']['scale'])
                    if u['text']==text and u['confidence']>=70 and b[0]-sp*.3<=x<=b[2]+sp*.3:support.append({'text':text,'sourceBox':b,'confidence':u['confidence'],'rowRead':qi})
            if len({q['rowRead']for q in support})<2:continue
            if abs((inkbox[0]+inkbox[2])/2-x)>.65*sp:continue
            if lyric is not None and lyric.findtext('text')==text:continue
            if n.find('lyric')is not None and lyric is None:continue
            if lyric is None:
                lyric=ET.SubElement(n,'lyric',number=verse);ET.SubElement(lyric,'syllabic').text='single';ET.SubElement(lyric,'text').text=text
            else:lyric.find('text').text=text
            evidence=['unique physical note column and neighboring bounds','intact isolated printed glyph; no cell-edge clipping','two matching local PSM 8/10/13 reads and two raw row symbol readings; correlated evidence','same physical verse row; rest/tie guards']
            changes.append({'feature':'lyric-recovery'if before else 'lyric','ruleVersion':VERSION,'before':before,'after':ET.tostring(lyric,encoding='unicode'),'eventIds':[e['id']],'sourceBox':inkbox,'source':VERSION,'evidence':evidence,'reviewRequired':True})
            records.append({'feature':'lyric','recoveryVersion':VERSION,'eventId':e['id'],'status':'applied-candidate','text':text,'sourceBox':inkbox,'rowBox':row,'cellBox':cell,'rowSupport':support,'evidence':evidence,'reviewRequired':True})


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
    for e in events:byvoice[(e['partIndex'],e['element'].findtext('staff','1'),e['voice'])].append(e)
    for r in records:
        if r['status']not in ('applied-candidate','preserved-existing'):continue
        e=em[r['eventId']];n=e['element'];l=n.find('lyric')
        if l is None or l.find('extend')is not None or l.findtext('text')!=r['text']or n.find('tie[@type="start"]')is None:continue
        voice=byvoice[(e['partIndex'],e['element'].findtext('staff','1'),e['voice'])];index=voice.index(e)
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


def recover_printed_extensions(frame,systems,events,links,records,changes):
    """A printed line at a real continuation column, independent of pitch/tie.

    Both attack and endpoint must have source glyphs. The continuation cell
    must contain only the isolated lyric-row line, not an unread text glyph.
    A word hyphen followed by another printed syllable therefore fails.
    Only the existing boolean start marker is emitted; endpoint provenance
    stays separate, rather than inventing stop text or changing note ties.
    """
    import cv2
    byvoice=defaultdict(list)
    for e in events:byvoice[(e['partIndex'],e['element'].findtext('staff','1'),e['voice'])].append(e)
    for voice in byvoice.values():
        for i,e in enumerate(voice[:-1]):
            n=e['element'];start=links.get(e['id'],{});end=voice[i+1];finish=links.get(end['id'],{})
            for lyric in n.findall('lyric'):
                if lyric.find('extend')is not None:continue
                before=ET.tostring(lyric,encoding='unicode')
                automatic=next((c for c in reversed(changes)if c.get('feature')in ('lyric','lyric-recovery','lyric-verse')and c.get('eventIds')==[e['id']]and c.get('after')==before),None)
                if not automatic:continue
                record={'feature':'lyric','recoveryVersion':VERSION,'extensionOnly':True,'eventId':e['id'],'status':'unresolved','reviewRequired':True,'reason':'extension source endpoints unresolved'}
                records.append(record)
                if e['kind']!='note'or end['kind']!='note'or start.get('status')!='physical-candidate'or finish.get('status')!='physical-candidate':continue
                if e['systemIndex']!=end['systemIndex']:
                    record['reason']='cross-system printed extension endpoints unresolved';continue
                if e['measureIndex']!=end['measureIndex']:
                    record['reason']='cross-measure extension duration proof required';continue
                if Fraction(e['onset'])+Fraction(e['duration'])!=Fraction(end['onset']):continue
                if end['element'].find('lyric[@number="'+lyric.get('number','')+'"]')is not None:
                    record['reason']='next event has a new lyric attack';continue
                s=next(s for s in systems if s['systemIndex']==e['systemIndex']);sp=s['spacing'];sx=start['geometry']['center'][0];ex=finish['geometry']['center'][0]
                if ex<=sx+sp:continue
                source=automatic.get('sourceBox')
                if not source:continue
                rows=detect_rows(frame,s,systems[s['systemIndex']+1]['lines'][0]-5*sp if s['systemIndex']+1<len(systems)else None)
                row=next((b for b in rows if b[1]<=sum(source[1::2])/2<=b[3]),None)
                if row is None:record['reason']='printed lyric row not detected';continue
                if row[1]<=s['lines'][-1]+.7*sp:record['reason']='line overlaps staff zone';continue
                y0,y1=int(row[1]),int(row[3]);x0=max(int(sx+.65*sp),int(ex-.85*sp));x1=min(frame.width,int(ex+.85*sp)+1)
                if x1<=x0:continue
                mask=(np.asarray(frame.crop((x0,y0,x1,y1)))<175).astype('uint8')
                attack=np.asarray(frame.crop((max(0,int(sx-.9*sp)),y0,min(frame.width,int(sx+.9*sp)+1),y1)))<175
                attack_rows=np.flatnonzero(attack.any(axis=1))
                actual_baseline=y0+int(attack_rows[-1])if len(attack_rows)else None
                _,_,stats,_=cv2.connectedComponentsWithStats(mask,8)
                marks=[];text_ink=[]
                for x,y,w,h,area in stats[1:]:
                    box=[int(x0+x),int(y0+y),int(x0+x+w),int(y0+y+h)]
                    row_midline=abs(y+h/2-mask.shape[0]/2)<=sp*.65
                    word_baseline=actual_baseline is not None and abs(y0+y+h/2-actual_baseline)<=sp*.35
                    if .35*sp<=w<=2*sp and 1<=h<=.45*sp and w>=2*h and (row_midline or word_baseline):marks.append(box)
                    elif area>=2:text_ink.append(box)
                record.update(sourceBox=[x0,y0,x1,y1],printedMarkBoxes=marks,otherInkBoxes=text_ink,endEventId=end['id'])
                if len(marks)!=1:record['reason']='single printed extension line absent';continue
                if text_ink:record['reason']='continuation column has text or ambiguous ink';continue
                # A start syllable must be printed, not merely present in XML.
                ys=attack_rows
                if not len(ys)or ys[-1]-ys[0]<sp:record['reason']='printed attack syllable missing';continue
                ET.SubElement(lyric,'extend');after=ET.tostring(lyric,encoding='unicode')
                evidence=['printed lyric-row horizontal continuation mark','unique source start and endpoint note columns','same voice and verse with contiguous time','no new printed syllable in endpoint cell; not OCR absence','printed start syllable ink']
                changes.append({'feature':'lyric-recovery','ruleVersion':VERSION,'before':before,'after':after,'eventIds':[e['id']],'sourceBox':marks[0],'source':VERSION,'evidence':evidence,'reviewRequired':True})
                record.update(status='applied-candidate',reason='printed extension endpoint proven without pitch/tie requirement',evidence=evidence,extendStatus='derived start boolean; printed endpoint preserved in evidence')
