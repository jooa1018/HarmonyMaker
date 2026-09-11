"""Evaluation ONLY. Invokes the unchanged v1.2 comparator after inference finishes."""
from pathlib import Path
import argparse,sys,json,hashlib
from collections import Counter

def main(v):
    sys.path.insert(0,str(v.compare));import evaluate as ev
    assert ev.P.resolve()==v.compare.resolve()
    refs={'user-jpeg':ev.original_reference(),'independent-a':ev.reference_a(),'independent-b':ev.normalize([v.compare/'fixtures/independent-b.reference.musicxml'])}
    if (v.evidence/'full-holdout-c/candidate/C-integrated.candidate.musicxml').exists():refs['holdout-c']=ev.normalize([v.evidence/'holdout-c/holdout.reference.musicxml'])
    rows=[]
    for case,ref in refs.items():
        for stage,name in [('A','A-homr.raw.musicxml'),('B','B-chords.candidate.musicxml'),('C','C-integrated.candidate.musicxml')]:
            path=(v.evidence/'full-holdout-c/candidate' if case=='holdout-c' else v.evidence/'runs'/case/v.version)/name;out=v.evidence/'evaluation'/v.version/case/stage
            result=ev.run(case+'-'+stage,ref,[path],out)
            pred=ev.normalize([path]);summary={'case':case,'stage':stage,**result}
            detail=json.loads((out/'evaluation.json').read_text(encoding='utf-8'))
            rf,pf=ev.flatten(ref),ev.flatten(pred);joint=0;text=0
            for pair in detail['pairs']:
                if pair['referenceIndex'] is None or pair['predictionIndex'] is None:continue
                r,p=rf[pair['referenceIndex']],pf[pair['predictionIndex']]
                if not r.get('lyric'):continue
                rw=[w for l in r['lyric'] for w in l.get('words',[])];pw=[w for l in p.get('lyric',[]) for w in l.get('words',[])]
                text+=rw==pw
                if ev.lyric_semantics(r['lyric'])==ev.lyric_semantics(p.get('lyric',[])) and not any(f in pair.get('fieldErrors',[]) for f in ev.CORE+['printed','onset','voice']):joint+=1
            summary['lyricTextOnAlignedEventMatches']=text
            summary['lyricSemanticsAndEventVoiceMatches']=joint
            rc=[{'printed':i,'onset':h['onset'],'value':h['value']} for i,m in enumerate(ref['measures'],1) for h in m['chords']]
            pc=[{'printed':i,'onset':h['onset'],'value':h['value']} for i,m in enumerate(pred['measures'],1) for h in m['chords']]
            mismatch=[]
            for pair in detail['chordPairs']:
                if pair['referenceIndex'] is None or pair['predictionIndex'] is None:continue
                a,b=rc[pair['referenceIndex']],pc[pair['predictionIndex']]
                if pair['operation']!='exact':mismatch.append({'reference':a,'prediction':b,'valueError':a['value']!=b['value'],'positionError':(a['printed'],a['onset'])!=(b['printed'],b['onset'])})
            summary['alignedChordValueErrors']=sum(x['valueError'] for x in mismatch)
            summary['alignedChordPositionErrors']=sum(x['positionError'] for x in mismatch)
            (out/'chord-mismatches.json').write_text(json.dumps(mismatch,indent=2),encoding='utf-8')
            summary['overfullMeasures']=pred['counts']['overfull']
            summary['retainedRawXmlSha256']=hashlib.sha256(path.read_bytes()).hexdigest()
            rows.append(summary)
    dest=v.evidence/'evaluation'/v.version;dest.mkdir(parents=True,exist_ok=True)
    (dest/'comparison.json').write_text(json.dumps({'evaluatorVersion':'unchanged 2026-09-11 v1.2','evaluatorSha256':hashlib.sha256((v.compare/'evaluate.py').read_bytes()).hexdigest(),'normalizerSha256':hashlib.sha256((v.compare/'normalize_xml.py').read_bytes()).hexdigest(),'rows':rows},indent=2),encoding='utf-8')
    print(json.dumps([{k:r.get(k) for k in ['case','stage','referenceEvents','predictedEvents','coreAlignmentCounts','completeEventTupleMatches','alignedFieldErrors','referenceChords','predictedChords','chordAlignmentCounts','knownReferenceLyricEvents','knownLyricEventsMatched','predictionKinds']} for r in rows],indent=2))

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--compare',type=Path,required=True);a.add_argument('--evidence',type=Path,required=True);a.add_argument('--version',default='v4');main(a.parse_args())
