# Project-owned runtime glue, moved from the private engine-compare folder (original sha256 1026453d6fe616a1c2780ada28aaada183df83f2206517dc8ebed96ae7eebf5d).
# Tracked here so the OMR runner hash covers it; behaviour unchanged except path resolution.
"""Observation-only wrapper: delegates unchanged recognition to the pinned homr CLI."""
import json,sys,time,traceback,os
from pathlib import Path
from xml.etree import ElementTree as ET
out=Path(sys.argv[1]).parent
network_attempts=[]
def audit(event,args):
    if event in ['socket.connect','socket.connect_ex','socket.getaddrinfo','socket.gethostbyname','subprocess.Popen','os.system'] or (event=='socket.__new__' and len(args)>1 and args[1] in (2,10,23)):
        network_attempts.append({'event':event,'args':str(args)[:500]})
        raise PermissionError('Offline recognition prohibits network or child processes: '+event)
sys.addaudithook(audit)
# from_image.py runs this with cwd=<compare>/homr-source (the pinned homr checkout).
if os.name=='nt':sys.path.insert(0,str(Path.cwd()))
import cv2,numpy as np
import homr.main as main
import homr.staff_parsing as staff
import homr.music_xml_generator as generator

def write(name,data):
    (out/name).write_text(json.dumps(data,indent=2,default=lambda v:v.tolist() if isinstance(v,np.ndarray) else str(v)),encoding='utf-8')
def symbols(rows):
    return [[{'text':str(s),'fields':vars(s)} for s in row] for row in rows]
old_generate=main.generate_xml
def generate(args,rows,title):
    write('symbols-before-xml.json',{'voices':symbols(rows),'title':title})
    return old_generate(args,rows,title)
main.generate_xml=generate
old_parse=staff.parse_staff_image
def parse(*args,**kwargs):
    value=old_parse(*args,**kwargs)
    write(f'raw-staff-{args[1]}-symbols.json',symbols([value]))
    return value
staff.parse_staff_image=parse
old_ties=generator.convert_ties;tie_counter=0
def ties(part):
    global tie_counter
    tie_counter+=1
    ET.ElementTree(part).write(out/f'part-{tie_counter}-before-tie-conversion.xml',encoding='utf-8',xml_declaration=True)
    value=old_ties(part)
    ET.ElementTree(part).write(out/f'part-{tie_counter}-after-tie-conversion.xml',encoding='utf-8',xml_declaration=True)
    return value
generator.convert_ties=ties
transforms=[]
for name in ['autocrop','resize_image']:
    old=getattr(main,name)
    def observer(image,old=old,name=name):
        value=old(image)
        transforms.append({'operation':name,'beforeShape':list(image.shape),'afterShape':list(value.shape)})
        cv2.imwrite(str(out/(name+'.png')),value)
        write('input-transforms.json',transforms)
        return value
    setattr(main,name,observer)
started=time.monotonic();error=None
try:
    main.main()
except BaseException as exc:
    error=repr(exc);traceback.print_exc();raise
finally:
    write('recognition-process.json',{'elapsedSeconds':time.monotonic()-started,'error':error,'argv':sys.argv,'networkInterfaces':Path('/proc/net/dev').read_text() if os.name!='nt' else None,'networkAttemptsBlocked':network_attempts,'offlineMechanism':'Python socket/DNS/subprocess audit denial; CPU ONNX; no external image service; Linux also network=none','observationOnly':True})
