"""Open a file with the elevated process's backup/restore privileges.

Uses documented Windows restore semantics. Does not change file ownership, ACLs,
service state, or machine-wide settings.
"""
import ctypes
from ctypes import wintypes as w
import os
import msvcrt

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
adv = ctypes.WinDLL("advapi32", use_last_error=True)
k32.GetCurrentProcess.restype = w.HANDLE
k32.CloseHandle.argtypes = [w.HANDLE]
adv.OpenProcessToken.argtypes = [w.HANDLE, w.DWORD, ctypes.POINTER(w.HANDLE)]
adv.OpenProcessToken.restype = w.BOOL


class LUID(ctypes.Structure):
    _fields_ = [("LowPart", w.DWORD), ("HighPart", w.LONG)]


class PRIVILEGE(ctypes.Structure):
    _fields_ = [("Luid", LUID), ("Attributes", w.DWORD)]


class TOKEN_PRIVILEGES(ctypes.Structure):
    _fields_ = [("PrivilegeCount", w.DWORD), ("Privileges", PRIVILEGE * 1)]


adv.LookupPrivilegeValueW.argtypes = [w.LPCWSTR, w.LPCWSTR, ctypes.POINTER(LUID)]
adv.LookupPrivilegeValueW.restype = w.BOOL
adv.AdjustTokenPrivileges.argtypes = [w.HANDLE, w.BOOL, ctypes.POINTER(TOKEN_PRIVILEGES),
                                    w.DWORD, ctypes.c_void_p, ctypes.c_void_p]
adv.AdjustTokenPrivileges.restype = w.BOOL
k32.CreateFileW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, ctypes.c_void_p,
                           w.DWORD, w.DWORD, w.HANDLE]
k32.CreateFileW.restype = w.HANDLE


def enable_restore_privileges():
    token = w.HANDLE()
    if not adv.OpenProcessToken(k32.GetCurrentProcess(), 0x20 | 0x8, ctypes.byref(token)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        for name in ("SeBackupPrivilege", "SeRestorePrivilege"):
            luid = LUID()
            if not adv.LookupPrivilegeValueW(None, name, ctypes.byref(luid)):
                raise ctypes.WinError(ctypes.get_last_error())
            privileges = TOKEN_PRIVILEGES(1, (PRIVILEGE * 1)(PRIVILEGE(luid, 2)))
            ctypes.set_last_error(0)
            if not adv.AdjustTokenPrivileges(token, False, ctypes.byref(privileges), 0, None, None):
                raise ctypes.WinError(ctypes.get_last_error())
            if ctypes.get_last_error() == 1300:
                raise PermissionError(f"{name} is unavailable; run as administrator")
    finally:
        k32.CloseHandle(token)


def open_for_restore(path, exclusive=True):
    enable_restore_privileges()
    handle = k32.CreateFileW(str(path), 0x80000000 | 0x40000000,
                             0 if exclusive else 7, None, 3, 0x02000000, None)
    if handle == w.HANDLE(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        descriptor = msvcrt.open_osfhandle(handle, os.O_BINARY | os.O_RDWR)
    except BaseException:
        k32.CloseHandle(handle)
        raise
    return os.fdopen(descriptor, "r+b", buffering=0)
