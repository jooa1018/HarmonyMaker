"""One local command: raster -> untouched homr output -> integration candidates.

All children are sequential. The pinned observer/pipeline deny network operations.
Use run_local.py around this command for parent/child resource observation.
"""
from pathlib import Path
import argparse,subprocess,sys,shutil,json,time,hashlib

def main(v):
    start=time.monotonic();v.out.mkdir(parents=True,exist_ok=False)
    def stage(name):
        if getattr(v,'stage_file',None):
            temporary=v.stage_file.with_suffix('.tmp');temporary.write_text(json.dumps({'stage':name,'at':time.time()}),encoding='utf-8');temporary.replace(v.stage_file)
    py=v.compare/'homr-windows-env/Scripts/python.exe';cache=v.cache
    pin=subprocess.check_output(['git','-c','safe.directory='+str((v.compare/'homr-source').resolve()),'-C',str(v.compare/'homr-source'),'rev-parse','HEAD'],text=True).strip()
    assert pin=='457e7c6518a10ba755db2e60883419e56c4d7369',pin
    if cache is None:
        stage('recognizing')
        cache=v.out/'raw-homr';cache.mkdir();image=cache/('input'+v.image.suffix.lower());shutil.copyfile(v.image,image)
        subprocess.run([str(py),str(v.compare/'homr_observe.py'),str(image),'--debug','--write-staff-positions'],check=True,cwd=v.compare/'homr-source')
    stage('supplementing')
    subprocess.run([str(py),str(Path(__file__).with_name('pipeline.py')),'--compare',str(v.compare),'--image',str(v.image),'--cache',str(cache),'--out',str(v.out/'candidate'),'--language',v.language],check=True)
    # The replay stage consumes the just-finished inference as a file, but that
    # does not make a fresh recognition a previous-run cache hit.
    evidence_path=v.out/'candidate/evidence.json';evidence=json.loads(evidence_path.read_text(encoding='utf-8'))
    evidence['engine']['mode']='fresh local homr inference, followed by exact geometry replay and automatic supplements' if v.cache is None else 'reuse immutable inference cache; supplements are new automatic OCR, not a new homr run'
    evidence_path.write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
    (v.out/'execution.json').write_text(json.dumps({'input':str(v.image),'inputSha256':hashlib.sha256(v.image.read_bytes()).hexdigest(),'homrRevision':pin,'cacheReused':v.cache is not None,'cache':str(cache),'elapsedSeconds':time.monotonic()-start,'sequence':['homr inference or byte-bound saved output','geometry replay','chord OCR','lyric OCR','meter OCR','slash pixel corroboration'],'oracleInputs':False,'externalImageTransfer':False},indent=2),encoding='utf-8')

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--compare',type=Path,required=True);a.add_argument('--image',type=Path,required=True);a.add_argument('--out',type=Path,required=True);a.add_argument('--cache',type=Path);a.add_argument('--stage-file',type=Path);a.add_argument('--language',default='eng+kor');main(a.parse_args())
