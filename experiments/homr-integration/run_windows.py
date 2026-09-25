# Project-owned runtime glue, moved from the private engine-compare folder (original sha256 0b74f9abd64692306981e17907db326b163b24efa9c9f3836361ed7de5c45374).
# Tracked here so the OMR runner hash covers it; behaviour unchanged except path resolution.
"""Sequential, private Windows quality trials. Uses a process Job Object limit."""
import argparse,subprocess,json,time,hashlib,shutil,ctypes
from ctypes import wintypes as W
from pathlib import Path
P=Path(__file__).parent
K=ctypes.WinDLL('kernel32',use_last_error=True);PS=ctypes.WinDLL('psapi',use_last_error=True)
class MEMORY(ctypes.Structure):
    _fields_=[('length',W.DWORD),('load',W.DWORD),('totalPhysical',ctypes.c_ulonglong),('availablePhysical',ctypes.c_ulonglong),('totalPageFile',ctypes.c_ulonglong),('availablePageFile',ctypes.c_ulonglong),('totalVirtual',ctypes.c_ulonglong),('availableVirtual',ctypes.c_ulonglong),('availableExtendedVirtual',ctypes.c_ulonglong)]
class BASIC(ctypes.Structure):
    _fields_=[('ProcessUserTime',ctypes.c_longlong),('JobUserTime',ctypes.c_longlong),('LimitFlags',W.DWORD),('MinimumWorkingSet',ctypes.c_size_t),('MaximumWorkingSet',ctypes.c_size_t),('ActiveProcessLimit',W.DWORD),('Affinity',ctypes.c_size_t),('PriorityClass',W.DWORD),('SchedulingClass',W.DWORD)]
class IO(ctypes.Structure):_fields_=[(n,ctypes.c_ulonglong) for n in ['ReadOps','WriteOps','OtherOps','ReadBytes','WriteBytes','OtherBytes']]
class LIMIT(ctypes.Structure):_fields_=[('Basic',BASIC),('IO',IO),('ProcessMemoryLimit',ctypes.c_size_t),('JobMemoryLimit',ctypes.c_size_t),('PeakProcessMemoryUsed',ctypes.c_size_t),('PeakJobMemoryUsed',ctypes.c_size_t)]
class COUNTERS(ctypes.Structure):_fields_=[('cb',W.DWORD),('PageFaultCount',W.DWORD)]+[(n,ctypes.c_size_t) for n in ['PeakWorkingSetSize','WorkingSetSize','QuotaPeakPagedPoolUsage','QuotaPagedPoolUsage','QuotaPeakNonPagedPoolUsage','QuotaNonPagedPoolUsage','PagefileUsage','PeakPagefileUsage','PrivateUsage']]
K.CreateJobObjectW.argtypes=[ctypes.c_void_p,W.LPCWSTR];K.CreateJobObjectW.restype=W.HANDLE
K.SetInformationJobObject.argtypes=[W.HANDLE,ctypes.c_int,ctypes.c_void_p,W.DWORD]
K.QueryInformationJobObject.argtypes=[W.HANDLE,ctypes.c_int,ctypes.c_void_p,W.DWORD,ctypes.c_void_p]
K.AssignProcessToJobObject.argtypes=[W.HANDLE,W.HANDLE]
K.SetProcessAffinityMask.argtypes=[W.HANDLE,ctypes.c_size_t]
K.TerminateJobObject.argtypes=[W.HANDLE,W.UINT]
K.CloseHandle.argtypes=[W.HANDLE]
K.OpenProcess.argtypes=[W.DWORD,W.BOOL,W.DWORD];K.OpenProcess.restype=W.HANDLE
PS.GetProcessMemoryInfo.argtypes=[W.HANDLE,ctypes.c_void_p,W.DWORD]
def mem():
    m=MEMORY();m.length=ctypes.sizeof(m);K.GlobalMemoryStatusEx(ctypes.byref(m));return {k:getattr(m,k) for k,_ in m._fields_}
def job_processes(job):
    buf=ctypes.create_string_buffer(4096)
    if not K.QueryInformationJobObject(job,3,buf,len(buf),None):return []
    count=ctypes.c_uint32.from_buffer(buf,4).value
    rows=[]
    for i in range(count):
        pid=ctypes.c_size_t.from_buffer(buf,8+i*ctypes.sizeof(ctypes.c_size_t)).value
        handle=K.OpenProcess(0x410,False,pid)
        if not handle:continue
        c=COUNTERS();c.cb=ctypes.sizeof(c)
        if PS.GetProcessMemoryInfo(handle,ctypes.byref(c),ctypes.sizeof(c)):rows.append({'pid':pid,**{k:getattr(c,k) for k,_ in c._fields_}})
        K.CloseHandle(handle)
    return rows
def run(engine,label,input,ram,seconds):
    input=input.resolve()
    out=P/'runs'/(engine+'-windows')/label;assert not out.exists(),str(out);out.mkdir(parents=True)
    target=out/('input'+input.suffix.lower());shutil.copyfile(input,target)
    python_engine='homr' if engine=='audiveris' else engine
    command=[str(P/(python_engine+'-windows-env')/'Scripts/python.exe'),'-X','faulthandler',str(P/(engine+'_observe.py')),str(target)]
    if engine=='homr':command+=['--debug','--write-staff-positions']
    import os
    env={**os.environ,'PYTHONUNBUFFERED':'1','OMP_NUM_THREADS':'2','OPENBLAS_NUM_THREADS':'2','MKL_NUM_THREADS':'2','HF_HUB_OFFLINE':'1','NO_PROXY':'*','PYTHONUTF8':'1'}
    before=mem();manifest={'engine':engine,'label':label,'platform':'Windows CPU','input':str(input),'inputSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'command':command,'resourcePolicy':{'processorAffinityMask':5,'logicalProcessors':2,'processMemoryLimitMiB':ram,'gpu':False,'deadlineSeconds':seconds},'hostBefore':before,'externalImageTransfer':False,'oracleOrCorrectionsPassed':False}
    (out/'run.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    job=K.CreateJobObjectW(None,None);assert job
    info=LIMIT();info.Basic.LimitFlags=0x100|0x2000;info.ProcessMemoryLimit=ram*1024**2
    assert K.SetInformationJobObject(job,9,ctypes.byref(info),ctypes.sizeof(info)),ctypes.get_last_error()
    started=time.monotonic();observations=[];stop=None;low=0
    with (out/'stdout.log').open('wb') as so,(out/'stderr.log').open('wb') as se:
        proc=subprocess.Popen(command,cwd=str(P if engine=='audiveris' else P/(engine+'-source')),env=env,stdout=so,stderr=se)
        assert K.AssignProcessToJobObject(job,W.HANDLE(int(proc._handle))),ctypes.get_last_error()
        assert K.SetProcessAffinityMask(W.HANDLE(int(proc._handle)),5),ctypes.get_last_error()
        while proc.poll() is None:
            counter=COUNTERS();counter.cb=ctypes.sizeof(counter);PS.GetProcessMemoryInfo(W.HANDLE(int(proc._handle)),ctypes.byref(counter),ctypes.sizeof(counter))
            h=mem();observations.append({'elapsedSeconds':time.monotonic()-started,'host':h,'process':{k:getattr(counter,k) for k,_ in counter._fields_},'jobProcesses':job_processes(job)})
            low=low+1 if h['availablePageFile']<384*1024**2 else 0
            if time.monotonic()-started>seconds or low>=3:
                stop='deadline' if time.monotonic()-started>seconds else 'host available commit below 384 MiB for 3 samples';K.TerminateJobObject(job,124)
            time.sleep(2)
        K.QueryInformationJobObject(job,9,ctypes.byref(info),ctypes.sizeof(info),None)
        manifest.update({'elapsedSeconds':time.monotonic()-started,'returncode':proc.returncode,'stopReason':stop,'peakProcessCommitBytes':info.PeakProcessMemoryUsed,'peakJobCommitBytes':info.PeakJobMemoryUsed,'peakObservedWorkingSetBytes':max((sum(p['WorkingSetSize'] for p in o['jobProcesses']) for o in observations),default=0),'maxProcessPeakWorkingSetBytes':max((p['PeakWorkingSetSize'] for o in observations for p in o['jobProcesses']),default=0),'observations':observations,'hostAfter':mem()})
        K.CloseHandle(job)
    (out/'run.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in manifest.items() if k not in ['observations','command','hostBefore','hostAfter']},ensure_ascii=False),flush=True)
if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('engine');a.add_argument('label');a.add_argument('input',type=Path);a.add_argument('--ram',type=int,default=2048);a.add_argument('--seconds',type=int,default=900);v=a.parse_args();run(v.engine,v.label,v.input,v.ram,v.seconds)
