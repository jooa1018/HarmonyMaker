"""Isolated homr + existing OCR candidate pipeline. No evaluation data is read."""
from pathlib import Path
from xml.etree import ElementTree as ET
from collections import Counter,defaultdict
from dataclasses import asdict
import argparse,json,sys,hashlib,time,shutil,copy,re

def main(v):
    out=v.out.resolve();out.mkdir(parents=True,exist_ok=True)
    attempts=[]
    def offline(event,args):
        if event in ['socket.connect','socket.connect_ex','socket.getaddrinfo','socket.gethostbyname','subprocess.Popen','os.system'] or (event=='socket.__new__' and len(args)>1 and args[1] in (2,10,23)):
            attempts.append({'event':event,'args':str(args)[:400]});raise PermissionError('Offline local integration: '+event)
        if event=='open' and isinstance(args[0],str) and any(t in args[0].lower() for t in ['original-oracle','recovery-bundle','recovery.bundle','reference.musicxml','correction-history']):
            raise PermissionError('Evaluation/correction data must not enter recognition')
    sys.addaudithook(offline)
    from PIL import Image
    from geometry import replay_geometry,traced_xml,write,sha
    from score import observe,public,insert_at_time,add_candidate_notice
    from linking import build_links,locate_column
    from native_ocr import NativeOcr
    from supplements import lyrics,meter,slashes
    start=time.monotonic();timing={}
    source=v.image.resolve();cache=v.cache.resolve()
    cached_images=[p for p in cache.glob('input.*') if p.suffix.lower() in ['.png','.jpg','.jpeg']]
    assert len(cached_images)==1 and sha(source.read_bytes())==sha(cached_images[0].read_bytes()),'Cache must belong to byte-identical input raster'
    raw=cache/'input.musicxml';shutil.copyfile(raw,out/'A-homr.raw.musicxml')
    frame=Image.open(source).convert('L')
    systems=replay_geometry(v.compare,cache,out/'geometry');provenance=traced_xml(v.compare,cache,out/'geometry')
    root=ET.parse(raw).getroot();measures,events=observe(root);links,regions=build_links(measures,events,systems,provenance)
    write(out/'source-links.json',{'events':links,'measures':regions})
    timing['geometryReplaySeconds']=time.monotonic()-start
    sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'services/audiveris-provider'))
    import chord_ocr_image as ci
    import chord_ocr_model as cm
    ocr=NativeOcr(v.compare,out.parent.parent);raw_ocr=[];changes=[];candidates=[]
    def hypothesis(image,directory,stem,psm):
        directory.mkdir(parents=True,exist_ok=True);prepared=ci.prepare(image);prepared.save(directory/f'{stem}-psm{psm}.png')
        rows=ocr.recognize(prepared,psm=psm,whitelist=ci.WHITELIST)
        raw_ocr.append({'feature':'chord','crop':f'{stem}-psm{psm}.png','psm':psm,'oem':1,'language':'eng','words':rows})
        return cm.OcrHypothesis(''.join(r['text'] for r in rows),sum(r['confidence'] for r in rows)/len(rows),f'psm-{psm}') if rows else None
    ci.tesseract_hypothesis=hypothesis
    before=time.monotonic()
    for s in systems:
        si=s['systemIndex'];staff=cm.StaffGeometry(0,round(s['lines'][0]),tuple(round(x) for x in s['lines']),s['spacing'],round(s['bounds'][0]),round(s['bounds'][2]))
        for bi,box in enumerate(ci.segment_chord_boxes(frame,staff)):
            hs=ci.ocr_chord_hypotheses(frame.crop(box),out/'ocr-chords',f's{si}-b{bi}')
            options=defaultdict(list)
            for h in hs:
                resolved=cm.resolve_hypothesis(h,allow_low_confidence=True)
                if resolved:options[cm.spec_key(resolved[0])].append((h,resolved))
            # Keep the provider's recognition functions, but do not suppress a bass/quality conflict.
            supported=[(key,items) for key,items in options.items() if any(h.confidence>=20 for h,_ in items) or len({h.source for h,_ in items})>=2]
            record={'feature':'chord','systemIndex':si,'sourceBox':box,'hypotheses':[asdict(h) for h in hs],'options':[{'symbol':it[0][1][0].surface,'support':len(it)} for _,it in supported],'status':'unresolved'}
            if len(supported)!=1:
                record['reason']='conflicting chord semantics' if supported else 'no supported chord text';candidates.append(record);continue
            key,items=supported[0];h,(spec,score)=max(items,key=lambda pair:pair[1][1]);record['symbol']=asdict(spec)
            match=locate_column(box,si,links,regions);record['association']=match
            if match['status']=='supported-candidate':
                record.update(status='eligible-candidate',measureIndex=match['measureIndex'],onset=match['onset']);record['_spec']=spec
            candidates.append(record)
        print(json.dumps({'stage':'chord-ocr','system':si,'boxes':sum(c['systemIndex']==si for c in candidates)}),flush=True)
    groups=defaultdict(list)
    for c in candidates:
        if c['status']=='eligible-candidate':groups[(c['measureIndex'],c['onset'])].append(c)
    from fractions import Fraction
    for key,rows in sorted(groups.items(),key=lambda pair:(pair[0][0],Fraction(pair[0][1]))):
        if len(rows)!=1:
            for c in rows:c.update(status='unresolved',reason='multiple source boxes claim same harmony onset')
            continue
        c=rows[0];m=measures[key[0]];node=cm.harmony_element(m['element'],c['_spec'],0);node.attrib.pop('default-x',None)
        insert_at_time(m,node,key[1]);c['status']='applied-candidate'
        changes.append({'feature':'chord','before':None,'after':ET.tostring(node,encoding='unicode'),'measureId':m['id'],'onset':key[1],'eventIds':c['association']['eventIds'],'sourceBox':c['sourceBox'],'source':'existing chord segmentation / Tesseract / lexicon, new physical correspondence','evidence':c['association']['evidence'],'reviewRequired':True})
    for c in candidates:c.pop('_spec',None)
    timing['chordSeconds']=time.monotonic()-before
    add_candidate_notice(root);ET.ElementTree(root).write(out/'B-chords.candidate.musicxml',encoding='utf-8',xml_declaration=True)
    before=time.monotonic();text_candidates=lyrics(frame,systems,measures,events,links,regions,ocr,out,raw_ocr,changes,v.language);timing['lyricSeconds']=time.monotonic()-before
    before=time.monotonic();meter_candidates=meter(frame,systems,measures,events,links,regions,ocr,out,raw_ocr,changes);timing['meterSeconds']=time.monotonic()-before
    before=time.monotonic();slash_candidates=slashes(frame,systems,measures,events,links,regions,out,changes);timing['slashSeconds']=time.monotonic()-before
    # Preserve the pre-timeline automatic candidate, then apply exactly once.
    ET.ElementTree(root).write(out/'C-before-timeline.candidate.musicxml',encoding='utf-8',xml_declaration=True)
    from timeline import reconstruct
    before=time.monotonic();timeline=reconstruct(root,frame,systems,links,ocr);timing['timelineSeconds']=time.monotonic()-before
    changes.extend(timeline['changes'])
    write(out/'timeline-decisions.json',timeline)
    ocr.close()
    ET.ElementTree(root).write(out/'C-integrated.candidate.musicxml',encoding='utf-8',xml_declaration=True)
    all_candidates=candidates+text_candidates+meter_candidates+slash_candidates+timeline['decisions']
    evidence={'schemaVersion':1,'runtimeOracleUsed':False,'input':{'path':str(source),'sha256':sha(source.read_bytes()),'size':frame.size},'engine':{'homr':'457e7c6518a10ba755db2e60883419e56c4d7369','rawXmlSha256':sha(raw.read_bytes()),'mode':'reuse immutable inference cache; supplements are new automatic OCR, not a new homr run'},'coordinatePolicy':'exact pixel/XML replay + geometric corroboration; attention is an estimate; no rendered-coordinate or measure-count association','sourceEligibility':{'approved':False,'reason':'Automatic candidates do not establish original fidelity; unresolved mapping, unsupported symbols, source semantics and text must remain in Review.'},'changes':changes,'candidates':all_candidates,'unresolvedEventLinks':[id for id,r in links.items() if r['status']=='unresolved'],'unresolvedMeasureLinks':[r['measure']['id'] for r in regions if r['status']=='unresolved'],'networkAttemptsBlocked':attempts,'timing':{**timing,'totalSupplementSeconds':time.monotonic()-start},'counts':{'changesByFeature':dict(Counter(c['feature'] for c in changes)),'candidatesByStatus':dict(Counter(c['feature']+':'+c['status'] for c in all_candidates))},'limitations':['A/B/C are automatic hypotheses, not Source-approved.','No tempo, repeat, key, curve or lyric semantics are guessed from measure length.','One staff per detected system; multiple voices may be unresolved.','Manual correction burden unmeasured.','Native OCR C API uses existing official legacy-compatible traineddata; not identical to Linux provider LSTM model bundle.']}
    evidence['timeline']=timeline
    write(out/'ocr.raw.json',raw_ocr);write(out/'evidence.json',evidence)
    print(json.dumps(evidence['counts']),flush=True)

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--compare',type=Path,required=True);a.add_argument('--image',type=Path,required=True);a.add_argument('--cache',type=Path,required=True);a.add_argument('--out',type=Path,required=True);a.add_argument('--language',default='eng+kor');main(a.parse_args())
