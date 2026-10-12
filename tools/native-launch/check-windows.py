"""Exercise the release Windows launcher with disposable files and named pipes."""
import concurrent.futures
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid

binary = str(Path(sys.argv[1]).resolve())
results = []
owned_pids = set()
identity = subprocess.check_output([
    'powershell', '-NoProfile', '-Command',
    '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'
], text=True).strip()
kernel = ctypes.WinDLL('kernel32', use_last_error=True)
kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                              wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
kernel.CreateFileW.restype = wintypes.HANDLE
kernel.ReadFile.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
                           ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID]
kernel.WriteFile.argtypes = kernel.ReadFile.argtypes
kernel.CloseHandle.argtypes = [wintypes.HANDLE]


def check(name, condition):
    if not condition:
        raise AssertionError(name)
    results.append(name)
    print(name, file=sys.stderr, flush=True)


def invoke(identifier, files, cwd=None, extra=None):
    env = dict(os.environ, MM_LAUNCH_CHECK_ID=identifier, **(extra or {}))
    started = time.monotonic()
    run = subprocess.run([binary, 'open', '--', *map(str, files)], cwd=cwd, env=env,
                         capture_output=True, timeout=20)
    try:
        response = json.loads(run.stdout)
    except ValueError as error:
        raise AssertionError((run.returncode, run.stdout, run.stderr)) from error
    if response['results']:
        owned_pids.add(response['pid'])
    return run.returncode, response, time.monotonic() - started


def pipe_name(identifier):
    return rf'\\.\pipe\mastermind-launch-check-{identity}-{identifier}'


def wire(identifier, payload):
    handle = kernel.CreateFileW(pipe_name(identifier), 0xC0000000, 0, None, 3, 0, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        sent = wintypes.DWORD()
        data = ctypes.create_string_buffer(payload)
        if not kernel.WriteFile(handle, data, len(payload), ctypes.byref(sent), None):
            if ctypes.get_last_error() in (109, 232):
                return {'error': 'connection_closed'}
            raise ctypes.WinError(ctypes.get_last_error())
        chunks = bytearray()
        while b'\n' not in chunks:
            buffer = ctypes.create_string_buffer(65536)
            count = wintypes.DWORD()
            if not kernel.ReadFile(handle, buffer, len(buffer), ctypes.byref(count), None):
                if ctypes.get_last_error() in (109, 232):
                    break
                raise ctypes.WinError(ctypes.get_last_error())
            if not count.value:
                break
            chunks.extend(buffer.raw[:count.value])
        return json.loads(chunks) if chunks else {'error': 'connection_closed'}
    finally:
        kernel.CloseHandle(handle)


def stop(pid):
    subprocess.run(['taskkill', '/PID', str(pid), '/F'], capture_output=True, check=True)
    owned_pids.discard(pid)
    time.sleep(0.2)


def wait_window(pid):
    user = ctypes.WinDLL('user32', use_last_error=True)
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user.IsWindowVisible.argtypes = [wintypes.HWND]
    for _ in range(100):
        found = []
        @callback_type
        def visit(handle, _):
            owner = wintypes.DWORD()
            user.GetWindowThreadProcessId(handle, ctypes.byref(owner))
            text = ctypes.create_unicode_buffer(256)
            user.GetWindowTextW(handle, text, len(text))
            if owner.value == pid and user.IsWindowVisible(handle):
                found.append(text.value)
            return True
        user.EnumWindows(visit, 0)
        if 'mastermind — native launch check' in found:
            return True
        time.sleep(0.1)
    return False


try:
    with tempfile.TemporaryDirectory(prefix='mm-launch-') as directory:
        files = Path(directory)
        identifier = uuid.uuid4().hex
        originals = {}
        for name in ['a.md', '中文 notes.md', '-leading.md']:
            path = files / name
            path.write_bytes(b'# source\r\n\r\nUnchanged bytes.\r\n')
            originals[path] = path.read_bytes()
        code, response, cold = invoke(identifier, originals, files)
        check('release executable / Unicode / spaces / leading hyphen',
              code == 0 and [r['status'] for r in response['results']] == ['opened'] * 3)
        pid = response['pid']
        code, response, warm = invoke(identifier, ['.\\a.md', 'A.MD', 'missing', '.'], files)
        check('cwd / case alias / warm reuse / partial failure / directory rejection',
              code == 1 and response['pid'] == pid and
              [r['status'] for r in response['results']] == ['already_open', 'already_open', 'error', 'error'])
        check('incomplete onboarding accompanies admission', response['onboarding_needed'])
        check('visible native host window', wait_window(pid))
        check('incompatible protocol rejected',
              wire(identifier, b'{"version":999,"paths":[]}\n')['error'] == 'incompatible_version')
        check('malformed request rejected', wire(identifier, b'not json\n')['error'] == 'invalid_request')
        check('oversized frame bounded',
              wire(identifier, b'x' * 65537 + b'\n')['error'] in ['invalid_request', 'connection_closed'])
        check('unterminated frame bounded', wire(identifier, b'{}')['error'] == 'connection_closed')
        stop(pid)
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            runs = list(pool.map(lambda _: invoke(identifier, [files / 'a.md']), range(6)))
        check('host termination and concurrent cold starts keep one owner',
              all(r[0] == 0 for r in runs) and len({r[1]['pid'] for r in runs}) == 1 and
              sum(r[1]['results'][0]['status'] == 'opened' for r in runs) == 1)
        stop(runs[0][1]['pid'])
        code, response, elapsed = invoke(uuid.uuid4().hex, [files / 'a.md'],
                                         extra={'MM_LAUNCH_CHECK_UI_DELAY_MS': '5000'})
        check('admission precedes delayed window creation', code == 0 and elapsed < 4)
        stop(response['pid'])
        dropped = uuid.uuid4().hex
        code, _, _ = invoke(dropped, [files / 'a.md'], extra={'MM_LAUNCH_CHECK_DROP_REPLY': '1'})
        check('lost response reports unknown outcome', code == 3)
        code, response, _ = invoke(dropped, [files / 'a.md'])
        check('retry after lost response reuses admission',
              code == 0 and response['results'][0]['status'] == 'already_open')
        stop(response['pid'])
        check('document bytes unchanged', all(p.read_bytes() == data for p, data in originals.items()))
        print(json.dumps({'passed': results, 'cold_seconds': cold, 'warm_seconds': warm}, indent=2))
finally:
    for pid in owned_pids:
        subprocess.run(['taskkill', '/PID', str(pid), '/F'], capture_output=True)
