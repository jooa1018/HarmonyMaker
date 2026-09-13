"""Hold one Windows kernel mutex until the calling Node process closes stdin."""
import ctypes, hashlib, os, sys
from ctypes import wintypes as W

kernel=ctypes.WinDLL('kernel32',use_last_error=True)
kernel.CreateMutexW.argtypes=[ctypes.c_void_p,W.BOOL,W.LPCWSTR];kernel.CreateMutexW.restype=W.HANDLE
kernel.WaitForSingleObject.argtypes=[W.HANDLE,W.DWORD];kernel.WaitForSingleObject.restype=W.DWORD
kernel.ReleaseMutex.argtypes=[W.HANDLE];kernel.CloseHandle.argtypes=[W.HANDLE]
name='Local\\HarmonyMakerImage-'+hashlib.sha256(os.path.normcase(os.path.realpath(sys.argv[1])).encode()).hexdigest()
mutex=kernel.CreateMutexW(None,False,name)
if not mutex:raise OSError('LOCAL_IMAGE_MUTEX_UNAVAILABLE')
acquired=False
try:
    result=kernel.WaitForSingleObject(mutex,15000)
    if result not in (0,0x80):raise TimeoutError('LOCAL_IMAGE_MUTEX_TIMEOUT')
    acquired=True
    print('LOCKED',flush=True)
    sys.stdin.buffer.read(1)
finally:
    if acquired:kernel.ReleaseMutex(mutex)
    kernel.CloseHandle(mutex)
