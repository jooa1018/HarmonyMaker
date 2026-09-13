"""Reuse the comparison's Windows Job observer for sequential local commands."""
import argparse,sys,subprocess,time,os,json,ctypes,shutil
from pathlib import Path

def run(v):
    sys.path.insert(0,str(v.compare));import run_windows as w
    v.out.mkdir(parents=True,exist_ok=False)
    command=v.command[1:] if v.command and v.command[0]=='--' else v.command
    job=w.K.CreateJobObjectW(None,None);assert job
    limits=w.LIMIT();limits.Basic.LimitFlags=0x100|0x2000;limits.ProcessMemoryLimit=v.ram*1024**2
    manifest={'command':command,'platform':'Windows','gpu':False,'affinityMask':5,'logicalProcessors':2,'perProcessCommitLimitMiB':v.ram,'deadlineSeconds':v.seconds,'hostBefore':w.mem(),'scope':'command and Job children; Windows working set / commit are not Linux cgroup usage'}
    observations=[];started=time.monotonic();stop=None;low_commit=0;low_physical=0;p=None;owner=None;returncode=1;resumed=False
    env={**os.environ,'PYTHONUNBUFFERED':'1','PYTHONUTF8':'1','OMP_NUM_THREADS':'2','OPENBLAS_NUM_THREADS':'2','MKL_NUM_THREADS':'2','HF_HUB_OFFLINE':'1','NO_PROXY':'*'}
    try:
        assert w.K.SetInformationJobObject(job,9,ctypes.byref(limits),ctypes.sizeof(limits))
        if getattr(v,'owner_pid',None):
            # Keep a process HANDLE, so PID reuse cannot impersonate this owner.
            w.K.OpenProcess.argtypes=[w.W.DWORD,w.W.BOOL,w.W.DWORD];w.K.OpenProcess.restype=w.W.HANDLE
            w.K.WaitForSingleObject.argtypes=[w.W.HANDLE,w.W.DWORD];w.K.WaitForSingleObject.restype=w.W.DWORD
            owner=w.K.OpenProcess(0x100000,False,v.owner_pid)
            if not owner:raise RuntimeError('Worker owner unavailable')
        with (v.out/'stdout.log').open('wb') as so,(v.out/'stderr.log').open('wb') as se:
            # No child instruction executes before its whole process tree belongs
            # to this kill-on-close Job. Assignment failure cannot leak children.
            p=subprocess.Popen(command,stdout=so,stderr=se,env=env,creationflags=0x4)
            assert w.K.AssignProcessToJobObject(job,w.W.HANDLE(int(p._handle)))
            assert w.K.SetProcessAffinityMask(w.W.HANDLE(int(p._handle)),5)
            resume=ctypes.WinDLL('ntdll').NtResumeProcess;resume.argtypes=[w.W.HANDLE];resume.restype=ctypes.c_long
            owner_state=w.K.WaitForSingleObject(owner,0) if owner else 258
            if owner_state not in (0,258):raise RuntimeError('Owner wait failed')
            if getattr(v,'cancel_file',None) and v.cancel_file.exists():stop='cancelled'
            elif owner_state==0:stop='worker owner exited'
            if stop:assert w.K.TerminateJobObject(job,130 if stop=='cancelled' else 124)
            else:
                assert resume(w.W.HANDLE(int(p._handle)))==0
                resumed=True
            while p.poll() is None:
                host=w.mem();observations.append({'seconds':time.monotonic()-started,'host':host,'processes':w.job_processes(job)})
                low_commit=low_commit+1 if host['availablePageFile']<384*1024**2 else 0
                low_physical=low_physical+1 if host['availablePhysical']<128*1024**2 else 0
                owner_state=w.K.WaitForSingleObject(owner,0) if owner else 258
                if owner_state not in (0,258):raise RuntimeError('Owner wait failed')
                if getattr(v,'cancel_file',None) and v.cancel_file.exists():stop='cancelled'
                elif owner_state==0:stop='worker owner exited'
                elif time.monotonic()-started>v.seconds:stop='deadline'
                elif low_commit>=3 or low_physical>=10:stop='sustained host memory pressure'
                elif shutil.disk_usage(v.out).free<256*1024**2:stop='low disk space'
                if stop:assert w.K.TerminateJobObject(job,130 if stop=='cancelled' else 124)
                time.sleep(.5)
            returncode=p.returncode
    except Exception as error:
        stop=('observer runtime failed: ' if resumed else 'observer preparation failed: ')+type(error).__name__
        if p is not None and p.poll() is None:
            try:p.terminate()
            except OSError:pass
    finally:
        w.K.QueryInformationJobObject(job,9,ctypes.byref(limits),ctypes.sizeof(limits),None)
        # Closing this Job is the final tree cleanup even if terminate/wait fails.
        w.K.CloseHandle(job)
        if owner:w.K.CloseHandle(owner)
        if p is not None and p.poll() is None:
            try:p.wait(timeout=10)
            except subprocess.TimeoutExpired:stop=(stop or 'observer runtime failed')+'; child exit not confirmed'
        manifest.update(elapsedSeconds=time.monotonic()-started,returncode=returncode,stopReason=stop,peakProcessCommitBytes=limits.PeakProcessMemoryUsed,peakJobCommitBytes=limits.PeakJobMemoryUsed,peakObservedAggregateWorkingSetBytes=max((sum(p['WorkingSetSize'] for p in o['processes']) for o in observations),default=0),maxProcessPeakWorkingSetBytes=max((p['PeakWorkingSetSize'] for o in observations for p in o['processes']),default=0),maxConcurrentProcesses=max((len(o['processes']) for o in observations),default=0),observations=observations,hostAfter=w.mem())
    (v.out/'resources.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in manifest.items() if k not in ['observations','hostBefore','hostAfter','command']}),flush=True)
    raise SystemExit(returncode)

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--compare',type=Path,required=True);a.add_argument('--out',type=Path,required=True);a.add_argument('--seconds',type=int,default=600);a.add_argument('--ram',type=int,default=2048);a.add_argument('--cancel-file',type=Path);a.add_argument('--owner-pid',type=int);a.add_argument('command',nargs=argparse.REMAINDER);run(a.parse_args())
