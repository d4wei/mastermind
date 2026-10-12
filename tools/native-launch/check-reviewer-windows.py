"""Exercise the installed reviewer through Tauri's Windows WebDriver bridge."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid


binary = Path(sys.argv[1]).resolve()
driver_binary = Path(sys.argv[2]).resolve()
edge_driver = Path(sys.argv[3]).resolve()
base = 'http://127.0.0.1:4444'
element_key = 'element-6066-11e4-a52e-4f735466cecf'


def request(method, route, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(base + route, body, {'Content-Type': 'application/json'},
                                 method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise AssertionError((method, route, error.read().decode())) from error
    value = result.get('value')
    if isinstance(value, dict) and value.get('error'):
        raise AssertionError((method, route, value))
    return value


def until(label, check, timeout=15):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            result = check()
            if result:
                print(label, file=sys.stderr, flush=True)
                return result
        except (AssertionError, urllib.error.URLError) as error:
            last = error
        time.sleep(0.1)
    raise AssertionError((label, last))


def command(session, method, route, payload=None):
    return request(method, f'/session/{session}{route}', payload)


def element(session, selector):
    found = command(session, 'POST', '/element',
                    {'using': 'css selector', 'value': selector})
    return found[element_key]


def text(session, selector):
    return command(session, 'GET', f'/element/{element(session, selector)}/text')


def click(session, selector):
    command(session, 'POST', f'/element/{element(session, selector)}/click', {})


def replace_text(session, selector, content):
    target = element(session, selector)
    command(session, 'POST', f'/element/{target}/click', {})
    replacement = '\ue009a\ue000' + content
    command(session, 'POST', f'/element/{target}/value',
            {'text': replacement, 'value': list(replacement)})


def editor(session):
    return text(session, '.cm-content')


def replace_editor(session, content):
    replace_text(session, '.cm-content', content)


def window_for(pid):
    user = ctypes.WinDLL('user32', use_last_error=True)
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.IsWindowVisible.argtypes = [wintypes.HWND]
    found = []

    @callback_type
    def visit(handle, _):
        owner = wintypes.DWORD()
        user.GetWindowThreadProcessId(handle, ctypes.byref(owner))
        if owner.value == pid and user.IsWindowVisible(handle):
            found.append(handle)
        return True

    user.EnumWindows(visit, 0)
    return found[0] if found else None


def close_window(pid):
    user = ctypes.WinDLL('user32', use_last_error=True)
    user.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM,
                                  wintypes.LPARAM]
    user.PostMessageW.restype = wintypes.BOOL
    handle = window_for(pid)
    assert handle, 'Reviewer window disappeared before close request'
    assert user.PostMessageW(wintypes.HWND(handle), 0x0010, 0, 0), 'WM_CLOSE failed'


def admit(path, namespace):
    process = subprocess.run([str(binary), 'open', '--', str(path)], capture_output=True,
                             text=True, timeout=20,
                             env=dict(os.environ, MM_LAUNCH_CHECK_ID=namespace))
    assert process.returncode == 0, (process.stdout, process.stderr)
    response = json.loads(process.stdout)
    assert response['results'][0]['status'] == 'opened', response
    return response['pid']


def check(session, path, namespace):
    original = '# reviewer\r\n\r\nOriginal.\r\n'
    path.write_bytes(original.encode())
    pid = admit(path, namespace)
    until('installed reviewer renders the admitted Markdown',
          lambda: 'Original.' in text(session, 'article'))
    click(session, '.seg-btn[aria-label="Markdown"]')
    until('Markdown editor loads the source', lambda: 'Original.' in editor(session))

    edited = '# reviewer\n\nEdited 中文.\n'
    replace_editor(session, edited)
    until('autosave keeps CRLF and writes multilingual source',
          lambda: path.read_bytes() == edited.replace('\n', '\r\n').encode(), 20)

    disk = '# reviewer\r\n\r\nExternal clean edit.\r\n'
    path.write_bytes(disk.encode())
    until('clean external change reloads the editor',
          lambda: 'External clean edit.' in editor(session), 20)

    path.chmod(0o444)
    local = '# reviewer\n\nUnsaved local edit.\n'
    replace_editor(session, local)
    until('failed autosave reports an error and keeps disk bytes',
          lambda: 'Autosave failed' in text(session, '.toast-error') and
          path.read_bytes() == disk.encode(), 20)
    path.chmod(0o666)
    competing = '# reviewer\r\n\r\nExternal competing edit.\r\n'
    path.write_bytes(competing.encode())
    until('external change while dirty opens a conflict',
          lambda: 'Saving paused' in text(session, '.conflict-notice'), 20)
    click(session, '.conflict-compare')
    until('comparison retains base, local, and disk versions',
          lambda: 'External clean edit.' in text(
              session, '.conflict-versions section:nth-child(1)') and
          'Unsaved local edit.' in text(session, '.conflict-versions section:nth-child(2)') and
          'External competing edit.' in text(session, '.conflict-versions section:nth-child(3)'))
    result = '# reviewer\n\nMerged result 中文.\n'
    replace_text(session, '.conflict-result textarea', result)
    click(session, '.conflict-actions .btn-cta')
    until('reviewed merge result reaches disk with CRLF',
          lambda: path.read_bytes() == result.replace('\n', '\r\n').encode(), 20)

    path.chmod(0o444)
    replace_editor(session, '# reviewer\n\nFailed quit edit.\n')
    until('second failed save preserves the file',
          lambda: 'Autosave failed' in text(session, '.toast-error') and
          path.read_bytes() == result.replace('\n', '\r\n').encode(), 20)
    close_window(pid)
    until('title-bar close refuses unsaved changes',
          lambda: window_for(pid) and 'Changes remain unsaved' in text(session, '[role="alert"]'))
    assert 'Failed quit edit.' in editor(session), 'Unsaved editor text was lost'
    path.chmod(0o666)
    replace_editor(session, '# reviewer\n\nRecovered after failed quit.\n')
    until('editing after failed quit retries autosave',
          lambda: path.read_bytes() == b'# reviewer\r\n\r\nRecovered after failed quit.\r\n', 20)
    close_window(pid)
    until('title-bar close exits after save', lambda: not window_for(pid))


with tempfile.TemporaryDirectory(prefix='mm-reviewer-webdriver-') as directory:
    path = Path(directory) / 'reviewer 中文.md'
    namespace = uuid.uuid4().hex
    environment = dict(os.environ, MM_LAUNCH_CHECK_ID=namespace)
    log = open(Path(directory) / 'tauri-driver.log', 'w+b')
    driver = subprocess.Popen([str(driver_binary), '--native-driver', str(edge_driver)],
                              env=environment, stdout=log, stderr=subprocess.STDOUT)
    session = None
    failed = False
    try:
        until('Tauri WebDriver starts', lambda: request('GET', '/status').get('ready'))
        response = request('POST', '/session', {'capabilities': {'alwaysMatch': {
            'browserName': 'wry', 'tauri:options': {'application': str(binary)}
        }}})
        session = response['sessionId'] if 'sessionId' in response else None
        if not session:
            raise AssertionError(('Missing WebDriver session ID', response))
        check(session, path, namespace)
    except BaseException:
        failed = True
        raise
    finally:
        if path.exists():
            path.chmod(0o666)
        if session:
            try:
                command(session, 'DELETE', '')
            except Exception:
                pass
        driver.terminate()
        try:
            driver.wait(timeout=5)
        except subprocess.TimeoutExpired:
            driver.kill()
            driver.wait(timeout=5)
        if failed or driver.returncode not in (0, -15, 1):
            log.seek(0)
            print(log.read().decode(errors='replace'), file=sys.stderr)
        log.close()
