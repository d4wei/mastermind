"""Exercise the installed reviewer through Tauri's Windows WebDriver bridge."""
import ctypes
from ctypes import wintypes
import base64
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid


binary = Path(sys.argv[1]).resolve()
launcher_binary = binary.with_name('mastermind-launch-console.exe')
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


def attribute(session, selector, name):
    return command(session, 'GET', f'/element/{element(session, selector)}/attribute/{name}')


def property_value(session, selector, name):
    return command(session, 'GET', f'/element/{element(session, selector)}/property/{name}')


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


def admit(paths, namespace, statuses):
    process = subprocess.run([str(launcher_binary), 'open', '--', *map(str, paths)],
                             capture_output=True, text=True, encoding='utf-8', timeout=20,
                             env=dict(os.environ, MM_LAUNCH_CHECK_ID=namespace))
    expected_code = 1 if 'error' in statuses else 0
    assert process.returncode == expected_code, (process.stdout, process.stderr)
    response = json.loads(process.stdout)
    assert [result['status'] for result in response['results']] == statuses, response
    assert [result['path'] for result in response['results']] == list(map(str, paths)), response
    return response


def check(session, path, namespace):
    original = '# reviewer\r\n\r\nOriginal.\r\n'
    path.write_bytes(original.encode())
    initial = admit([path], namespace, ['opened'])
    pid = initial['pid']
    until('installed reviewer renders the admitted Markdown',
          lambda: 'Original.' in text(session, 'article'))
    click(session, '.seg-btn[aria-label="Markdown"]')
    until('Markdown editor loads the source', lambda: 'Original.' in editor(session))

    first = path.with_name('first admitted.md')
    second = path.with_name('second admitted 中文.md')
    missing = path.with_name('missing.md')
    first.write_text('# First admitted\n\nFirst successful request file.\n', encoding='utf-8')
    second.write_text('# Second admitted\n\nSecond successful request file.\n', encoding='utf-8')
    batch = admit([missing, first, second], namespace, ['error', 'opened', 'opened'])
    assert batch['pid'] == pid, batch
    until('multi-file request activates its first successful file',
          lambda: 'First successful request file.' in editor(session))
    expected_files = [initial['results'][0]['canonical'],
                      batch['results'][1]['canonical'], batch['results'][2]['canonical']]

    def inventory_matches():
        options = command(session, 'POST', '/elements',
                          {'using': 'css selector', 'value': '.native-documents option[value]'})
        paths = [command(session, 'GET', f'/element/{option[element_key]}/text')
                 for option in options[1:]]
        return paths == expected_files

    until('file inventory preserves admission order and omits the failed path', inventory_matches)
    reopened = admit([path], namespace, ['already_open'])
    assert reopened['pid'] == pid, reopened
    until('repeat CLI open restores the original document', lambda: 'Original.' in editor(session))

    edited = '# reviewer\n\nEdited 中文.\n'
    replace_editor(session, edited)
    until('autosave keeps CRLF and writes multilingual source',
          lambda: path.read_bytes() == edited.replace('\n', '\r\n').encode(), 20)

    append_keys = '\ue009\ue010\ue000X'
    command(session, 'POST', f'/element/{element(session, ".cm-content")}/value',
            {'text': append_keys, 'value': list(append_keys)})
    appended = edited + 'X'
    until('single source history edit reaches disk',
          lambda: path.read_bytes() == appended.replace('\n', '\r\n').encode(), 20)
    admit([first], namespace, ['already_open'])
    until('source undo check switches to another document',
          lambda: 'First successful request file.' in editor(session))
    admit([path], namespace, ['already_open'])
    until('source undo check restores the appended document',
          lambda: editor(session).endswith('X'))
    target = element(session, '.cm-content')
    undo_keys = '\ue009z\ue000'
    command(session, 'POST', f'/element/{target}/value',
            {'text': undo_keys, 'value': list(undo_keys)})
    until('source undo survives a switch away and repeat open',
          lambda: not editor(session).endswith('X') and
          path.read_bytes() == edited.replace('\n', '\r\n').encode(), 20)
    redo_keys = '\ue009y\ue000'
    command(session, 'POST', f'/element/{element(session, ".cm-content")}/value',
            {'text': redo_keys, 'value': list(redo_keys)})
    until('source redo restores the single edit after switching',
          lambda: editor(session).endswith('X') and
          path.read_bytes() == appended.replace('\n', '\r\n').encode(), 20)
    command(session, 'POST', f'/element/{element(session, ".cm-content")}/value',
            {'text': undo_keys, 'value': list(undo_keys)})
    until('source history check restores the original edited bytes',
          lambda: not editor(session).endswith('X') and
          path.read_bytes() == edited.replace('\n', '\r\n').encode(), 20)

    disk = '# reviewer\r\n\r\nExternal clean edit.\r\n'
    path.write_bytes(disk.encode())
    until('clean external change reloads the editor',
          lambda: 'External clean edit.' in editor(session), 20)

    retired_parent = path.parent.with_name('documents-retired')
    replacement_parent = path.parent.with_name('documents-replacement')
    shutil.copytree(path.parent, replacement_parent)
    replacement = '# reviewer\r\n\r\nReplaced parent directory.\r\n'
    (replacement_parent / path.name).write_bytes(replacement.encode())
    path.parent.rename(retired_parent)
    replacement_parent.rename(path.parent)
    until('parent-directory replacement reloads the clean source without navigation',
          lambda: 'Replaced parent directory.' in editor(session), 20)
    later = '# reviewer\r\n\r\nLater edit in replaced parent.\r\n'
    path.write_bytes(later.encode())
    until('later edits in the replaced parent remain observable without focus changes',
          lambda: 'Later edit in replaced parent.' in editor(session), 20)
    path.write_bytes(disk.encode())
    until('parent replacement check restores the clean source for conflict checks',
          lambda: 'External clean edit.' in editor(session), 20)

    path.chmod(0o444)
    local = '# reviewer\n\nUnsaved local edit.\n'
    replace_editor(session, local)
    until('local changes remain in the editor before the failed save',
          lambda: 'Unsaved local edit.' in editor(session))
    until('failed autosave reports an error and keeps disk bytes',
          lambda: 'Autosave failed' in (attribute(
              session, '.toast-error [aria-label]', 'aria-label') or '') and
          path.read_bytes() == disk.encode(), 20)
    admit([first], namespace, ['already_open'])
    until('switching documents keeps the other admitted source available',
          lambda: 'First successful request file.' in editor(session))
    reopened = admit([path], namespace, ['already_open'])
    assert reopened['pid'] == pid, reopened
    until('reopening a failed-save document retains its unsaved source',
          lambda: 'Unsaved local edit.' in editor(session))
    assert path.read_bytes() == disk.encode(), 'Reopening changed the failed-save disk version'
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

    def comparison_matches(expected_disk):
        return (property_value(session, '.conflict-versions section:nth-child(1) pre',
                               'textContent') == disk.replace('\r\n', '\n') and
                property_value(session, '.conflict-versions section:nth-child(2) pre',
                               'textContent') == local and
                property_value(session, '.conflict-versions section:nth-child(3) pre',
                               'textContent') == expected_disk and
                property_value(session, '.conflict-result textarea', 'value') == result)

    until('comparison stores the edited Result without writing it',
          lambda: comparison_matches(competing) and path.read_bytes() == competing.encode())
    switched = admit([first], namespace, ['already_open'])
    assert switched['pid'] == pid, switched
    until('switching away from comparison renders another retained document',
          lambda: 'First successful request file.' in editor(session))
    reopened = admit([path], namespace, ['already_open'])
    assert reopened['pid'] == pid, reopened
    until('repeat CLI open retains comparison Base Local Disk and edited Result',
          lambda: comparison_matches(competing) and
          'Unsaved local edit.' in editor(session) and
          path.read_bytes() == competing.encode())

    later_disk = '# reviewer\r\n\r\nLater external competing edit.\r\n'
    path.write_bytes(later_disk.encode())
    until('later disk change makes comparison stale while retaining edited Result',
          lambda: comparison_matches(later_disk) and
          'Refresh them before saving' in text(session, '.conflict-comparison [role="alert"]') and
          property_value(session, '.conflict-actions .btn-cta', 'disabled') is True, 20)
    click(session, '.conflict-actions .btn-cta')
    assert path.read_bytes() == later_disk.encode(), 'Stale Save result overwrote the later disk edit'
    assert comparison_matches(later_disk), 'Stale Save result discarded comparison state'
    click(session, '.conflict-actions button:first-child')
    until('explicit refresh retains edited Result and enables reviewed saving',
          lambda: comparison_matches(later_disk) and
          property_value(session, '.conflict-actions .btn-cta', 'disabled') is False and
          path.read_bytes() == later_disk.encode(), 20)
    click(session, '.conflict-actions .btn-cta')
    until('reviewed merge result reaches disk with CRLF',
          lambda: path.read_bytes() == result.replace('\n', '\r\n').encode(), 20)

    path.chmod(0o444)
    replace_editor(session, '# reviewer\n\nFailed quit edit.\n')
    until('second failed save preserves the file',
          lambda: 'Autosave failed' in (attribute(
              session, '.toast-error [aria-label]', 'aria-label') or '') and
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


def capture_diagnostics(session, path, directory):
    directory.mkdir(exist_ok=True)
    state = {'file': str(path),
             'disk_bytes_hex': path.read_bytes().hex() if path.exists() else None}
    for label, route in [('source', '/source'), ('screenshot', '/screenshot')]:
        try:
            value = command(session, 'GET', route)
            if label == 'screenshot':
                (directory / 'reviewer.png').write_bytes(base64.b64decode(value))
            else:
                (directory / 'reviewer.html').write_text(value, encoding='utf-8')
        except Exception as error:
            state[label + '_error'] = str(error)
    (directory / 'state.json').write_text(json.dumps(state, indent=2), encoding='utf-8')


with tempfile.TemporaryDirectory(prefix='mm-reviewer-webdriver-') as directory:
    documents = Path(directory) / 'documents'
    documents.mkdir()
    path = documents / 'reviewer 中文.md'
    namespace = uuid.uuid4().hex
    environment = dict(os.environ, MM_LAUNCH_CHECK_ID=namespace)
    diagnostics = Path(__file__).with_name('check-reviewer-diagnostics')
    diagnostics.mkdir(exist_ok=True)
    log = open(diagnostics / 'tauri-driver.log', 'w+b')
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
        if session:
            try:
                capture_diagnostics(session, path, diagnostics)
            except Exception as error:
                print(f'Could not capture diagnostics: {error}', file=sys.stderr)
        raise
    finally:
        if path.exists():
            path.chmod(0o666)
        if session:
            try:
                command(session, 'DELETE', '')
            except Exception:
                pass
        try:
            subprocess.run(['taskkill', '/PID', str(driver.pid), '/T', '/F'],
                           capture_output=True, timeout=10)
        except subprocess.TimeoutExpired:
            driver.kill()
        try:
            driver.wait(timeout=5)
        except subprocess.TimeoutExpired:
            driver.kill()
            driver.wait(timeout=5)
        if failed or driver.returncode not in (0, -15, 1):
            log.seek(0)
            print(log.read().decode(errors='replace'), file=sys.stderr)
        log.close()
