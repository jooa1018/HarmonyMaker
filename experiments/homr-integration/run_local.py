"""Reuse the comparison's Windows Job observer for sequential local commands."""
import argparse,sys,subprocess,time,os,json,ctypes
from pathlib import Path

def run(v):
    sys.path.insert(0,str(v.compare));import run_windows as w
    v.out.mkdir(parents=True,exist_ok=False)
    command=v.command[1:] if v.command and v.command[0]=='--' else v.command
    job=w.K.CreateJobObjectW(None,None);assert job
    limits=w.LIMIT();limits.Basic.LimitFlags=0x100|0x2000;limits.ProcessMemoryLimit=v.ram*1024**2
    assert w.K.SetInformationJobObject(job,9,ctypes.byref(limits),ctypes.sizeof(limits))
    manifest={'command':command,'platform':'Windows','gpu':False,'affinityMask':5,'logicalProcessors':2,'perProcessCommitLimitMiB':v.ram,'deadlineSeconds':v.seconds,'hostBefore':w.mem(),'scope':'command and Job children; Windows working set / commit are not Linux cgroup usage'}
    observations=[];started=time.monotonic();stop=None;low_commit=0;low_physical=0
    env={**os.environ,'PYTHONUNBUFFERED':'1','PYTHONUTF8':'1','OMP_NUM_THREADS':'2','OPENBLAS_NUM_THREADS':'2','MKL_NUM_THREADS':'2','HF_HUB_OFFLINE':'1','NO_PROXY':'*'}
    with (v.out/'stdout.log').open('wb') as so,(v.out/'stderr.log').open('wb') as se:
        p=subprocess.Popen(command,stdout=so,stderr=se,env=env)
        assert w.K.AssignProcessToJobObject(job,w.W.HANDLE(int(p._handle)))
        assert w.K.SetProcessAffinityMask(w.W.HANDLE(int(p._handle)),5)
        while p.poll() is None:
            host=w.mem();observations.append({'seconds':time.monotonic()-started,'host':host,'processes':w.job_processes(job)})
            low_commit=low_commit+1 if host['availablePageFile']<384*1024**2 else 0
            low_physical=low_physical+1 if host['availablePhysical']<128*1024**2 else 0
            if time.monotonic()-started>v.seconds or low_commit>=3 or low_physical>=10:
                stop='deadline' if time.monotonic()-started>v.seconds else 'sustained host memory pressure';w.K.TerminateJobObject(job,124)
            time.sleep(.5)
        w.K.QueryInformationJobObject(job,9,ctypes.byref(limits),ctypes.sizeof(limits),None)
        manifest.update(elapsedSeconds=time.monotonic()-started,returncode=p.returncode,stopReason=stop,peakProcessCommitBytes=limits.PeakProcessMemoryUsed,peakJobCommitBytes=limits.PeakJobMemoryUsed,peakObservedAggregateWorkingSetBytes=max((sum(p['WorkingSetSize'] for p in o['processes']) for o in observations),default=0),maxProcessPeakWorkingSetBytes=max((p['PeakWorkingSetSize'] for o in observations for p in o['processes']),default=0),maxConcurrentProcesses=max((len(o['processes']) for o in observations),default=0),observations=observations,hostAfter=w.mem())
        w.K.CloseHandle(job)
    (v.out/'resources.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in manifest.items() if k not in ['observations','hostBefore','hostAfter','command']}),flush=True)
    raise SystemExit(p.returncode)

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--compare',type=Path,required=True);a.add_argument('--out',type=Path,required=True);a.add_argument('--seconds',type=int,default=600);a.add_argument('--ram',type=int,default=2048);a.add_argument('command',nargs=argparse.REMAINDER);run(a.parse_args())
