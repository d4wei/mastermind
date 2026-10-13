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
kernel.GetConsoleProcessList.argtypes = [ctypes.POINTER(wintypes.DWORD), wintypes.DWORD]
kernel.GetConsoleProcessList.restype = wintypes.DWORD
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


def detach_probe():
    if not kernel.FreeConsole():
        raise ctypes.WinError(ctypes.get_last_error())
    processes = (wintypes.DWORD * 1)()
    ctypes.set_last_error(0)
    if kernel.GetConsoleProcessList(processes, len(processes)):
        raise AssertionError('Probe parent must have no console')
    if ctypes.get_last_error() != 6:
        raise AssertionError(('Console detachment verification failed', ctypes.get_last_error()))


def has_console(pid):
    ctypes.set_last_error(0)
    if kernel.AttachConsole(pid):
        detach_probe()
        return True
    error = ctypes.get_last_error()
    if error != 6:
        raise AssertionError(('Console probe failed unexpectedly', error))
    return False


def check_hidden_console_detection():
    control = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'],
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, close_fds=True,
                               creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        deadline = time.monotonic() + 3
        while not has_console(control.pid):
            if control.poll() is not None or time.monotonic() >= deadline:
                raise AssertionError('Probe did not detect the hidden-console positive control')
            time.sleep(0.05)
    finally:
        control.kill()
        control.wait(timeout=5)


# A windowless console still makes AttachConsole fail with access denied on the caller.
detach_probe()
check_hidden_console_detection()
binary = str(Path(sys.argv[1]).resolve())
process = subprocess.Popen([binary], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, close_fds=True)
try:
    deadline = time.monotonic() + 15
    while not has_window(process.pid):
        if process.poll() is not None or time.monotonic() >= deadline:
            raise AssertionError(('GUI startup failed', process.poll()))
        time.sleep(0.1)
    if has_console(process.pid):
        raise AssertionError('Graphical application created a console')
    if process.poll() is not None:
        raise AssertionError('Graphical application exited during the console probe')
    print(json.dumps({'pid': process.pid, 'visible_window': True, 'console': False,
                      'hidden_console_control_detected': True}))
except BaseException:
    process.kill()
    process.wait(timeout=5)
    raise
