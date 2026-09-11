"""Local Tesseract 5.5.1 C API adapter for the existing chord OCR boundary.

Uses the official Audiveris-distributed native libraries and existing traineddata.
No network, command emulation, musical inference, or oracle inputs.
"""
from pathlib import Path
import ctypes as C
import os,zipfile,json,hashlib
import numpy as np

class NativeOcr:
    def __init__(self, compare: Path, private: Path):
        self.data=compare/'audiveris-portable/tessdata'
        self.bin=private/'native-ocr';self.bin.mkdir(parents=True,exist_ok=True)
        jars=compare/'audiveris-portable/files/Audiveris/app'
        provenance=[]
        for pattern in ['leptonica-*-windows-x86_64.jar','tesseract-*-windows-x86_64.jar']:
            jar=next(jars.glob(pattern))
            with zipfile.ZipFile(jar) as z:
                for name in z.namelist():
                    if not name.endswith('.dll'):continue
                    dest=self.bin/Path(name).name;data=z.read(name)
                    if not dest.exists():dest.write_bytes(data)
                    assert hashlib.sha256(dest.read_bytes()).digest()==hashlib.sha256(data).digest()
                    provenance.append({'jar':str(jar),'member':name,'sha256':hashlib.sha256(data).hexdigest()})
        self.search=os.add_dll_directory(str(self.bin));self.lib=C.CDLL(str(self.bin/'libtesseract55.dll'))
        self.handles={}
        self.fn('TessVersion',[],C.c_char_p)
        self.fn('TessBaseAPICreate',[],C.c_void_p)
        self.fn('TessBaseAPIInit2',[C.c_void_p,C.c_char_p,C.c_char_p,C.c_int],C.c_int)
        self.fn('TessBaseAPISetPageSegMode',[C.c_void_p,C.c_int],None)
        self.fn('TessBaseAPISetVariable',[C.c_void_p,C.c_char_p,C.c_char_p],C.c_int)
        self.fn('TessBaseAPISetImage',[C.c_void_p,C.c_void_p,C.c_int,C.c_int,C.c_int,C.c_int],None)
        self.fn('TessBaseAPISetSourceResolution',[C.c_void_p,C.c_int],None)
        self.fn('TessBaseAPIRecognize',[C.c_void_p,C.c_void_p],C.c_int)
        self.fn('TessBaseAPIGetIterator',[C.c_void_p],C.c_void_p)
        self.fn('TessResultIteratorGetPageIterator',[C.c_void_p],C.c_void_p)
        self.fn('TessResultIteratorGetUTF8Text',[C.c_void_p,C.c_int],C.c_void_p)
        self.fn('TessResultIteratorConfidence',[C.c_void_p,C.c_int],C.c_float)
        self.fn('TessResultIteratorNext',[C.c_void_p,C.c_int],C.c_int)
        self.fn('TessPageIteratorBoundingBox',[C.c_void_p,C.c_int,*([C.POINTER(C.c_int)]*4)],C.c_int)
        self.fn('TessResultIteratorDelete',[C.c_void_p],None)
        self.fn('TessDeleteText',[C.c_void_p],None)
        self.fn('TessBaseAPIClear',[C.c_void_p],None)
        self.fn('TessBaseAPIClearAdaptiveClassifier',[C.c_void_p],None)
        self.fn('TessBaseAPIDelete',[C.c_void_p],None)
        (self.bin/'provenance.json').write_text(json.dumps({'version':self.lib.TessVersion().decode(),'libraries':provenance,'traineddata':[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in self.data.glob('*.traineddata')],'adapter':'Existing Tesseract OCR via C API instead of unavailable Windows CLI; OEM and hypotheses recorded per call. No engine model substitution.'},indent=2),encoding='utf-8')

    def fn(self,name,args,result):
        f=getattr(self.lib,name);f.argtypes=args;f.restype=result

    def recognize(self,image,language='eng',psm=7,oem=1,whitelist='',symbols=False):
        key=(language,oem)
        if key not in self.handles:
            h=self.lib.TessBaseAPICreate()
            if self.lib.TessBaseAPIInit2(h,(self.data.as_posix()+'/').encode(),language.encode(),oem):
                self.lib.TessBaseAPIDelete(h);raise RuntimeError('Tesseract model init failed '+str(key))
            self.handles[key]=h
        h=self.handles[key];self.lib.TessBaseAPIClear(h);self.lib.TessBaseAPIClearAdaptiveClassifier(h)
        self.lib.TessBaseAPISetPageSegMode(h,psm)
        self.lib.TessBaseAPISetVariable(h,b'tessedit_char_whitelist',whitelist.encode('utf-8'))
        a=np.ascontiguousarray(image.convert('L'));height,width=a.shape
        self.lib.TessBaseAPISetImage(h,a.ctypes.data,width,height,1,width)
        self.lib.TessBaseAPISetSourceResolution(h,300)
        if self.lib.TessBaseAPIRecognize(h,None):raise RuntimeError('Tesseract recognize failed')
        it=self.lib.TessBaseAPIGetIterator(h);rows=[]
        if it:
            level=4 if symbols else 3
            while True:
                ptr=self.lib.TessResultIteratorGetUTF8Text(it,level)
                text=C.string_at(ptr).decode('utf-8',errors='replace') if ptr else ''
                if ptr:self.lib.TessDeleteText(ptr)
                box=[C.c_int() for _ in range(4)];page=self.lib.TessResultIteratorGetPageIterator(it)
                found=self.lib.TessPageIteratorBoundingBox(page,level,*map(C.byref,box))
                if text.strip() and found:rows.append({'text':text.strip(),'confidence':float(self.lib.TessResultIteratorConfidence(it,level)),'box':[v.value for v in box]})
                if not self.lib.TessResultIteratorNext(it,level):break
            self.lib.TessResultIteratorDelete(it)
        return rows

    def close(self):
        for h in self.handles.values():self.lib.TessBaseAPIDelete(h)
        self.handles.clear();self.search.close()
