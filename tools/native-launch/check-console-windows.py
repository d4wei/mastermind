"""Probe ordinary GUI startup from a parent with no console."""
import ctypes
from ctypes import wintypes
import json
from pathlib import Path
import subprocess
import sys
import time

kernel = ctypes.WinDLL('kernel32', use_last_error=True)
kernel.AttachConsole.argtypes = [wintypes.DWORD]
kernel.AttachConsole.restype = wintypes.BOOL
kernel.GetConsoleWindow.restype = wintypes.HWND
kernel.GetConsoleWindow.argtypes = []
kernel.FreeConsole.argtypes = []
kernel.FreeConsole.restype = wintypes.BOOL
user = ctypes.WinDLL('user32', use_last_error=True)
callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user.IsWindowVisible.argtypes = [wintypes.HWND]


def has_window(pid):
    found = []
    @callback_type
    def visit(handle, _):
        owner = wintypes.DWORD()
        user.GetWindowThreadProcessId(handle, ctypes.byref(owner))
        text = ctypes.create_unicode_buffer(256)
        user.GetWindowTextW(handle, text, len(text))
        if (owner.value == pid and user.IsWindowVisible(handle)
                and text.value == 'mastermind — native launch check'):
            found.append(handle)
        return True
    user.EnumWindows(visit, 0)
    return bool(found)


if kernel.GetConsoleWindow():
    raise AssertionError('Probe parent must have no console')
binary = str(Path(sys.argv[1]).resolve())
process = subprocess.Popen([binary], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, close_fds=True)
try:
    deadline = time.monotonic() + 15
    while not has_window(process.pid):
        if process.poll() is not None or time.monotonic() >= deadline:
            raise AssertionError(('GUI startup failed', process.poll()))
        time.sleep(0.1)
    if kernel.AttachConsole(process.pid):
        kernel.FreeConsole()
        raise AssertionError('Graphical application created a console')
    error = ctypes.get_last_error()
    if error != 6:
        raise AssertionError(('Console probe failed unexpectedly', error))
    print(json.dumps({'pid': process.pid, 'visible_window': True, 'console': False}))
except BaseException:
    process.kill()
    process.wait(timeout=5)
    raise
