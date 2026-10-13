"""Exercise the packaged Unix launcher; all files and endpoints are disposable."""
import concurrent.futures
import json
import errno
import threading
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time

binary = str(Path(sys.argv[1]).resolve())
results = []
owned_pids = set()


def check(name, condition):
    if not condition:
        raise AssertionError(name)
    results.append(name)


def invoke(root, files, cwd=None, extra=None):
    env = dict(os.environ, MM_LAUNCH_CHECK_DIR=str(root), **(extra or {}))
    started = time.monotonic()
    run = subprocess.run([binary, 'open', '--', *map(str, files)], cwd=cwd, env=env,
                         capture_output=True, timeout=15)
    response = json.loads(run.stdout)
    if response['results']:
        owned_pids.add(response['pid'])
    return run.returncode, response, time.monotonic() - started


def wire(root, payload):
    with socket.socket(socket.AF_UNIX) as stream:
        stream.settimeout(12)
        stream.connect(str(root / 'launch.sock'))
        stream.sendall(payload)
        try:
            stream.shutdown(socket.SHUT_WR)
        except OSError as error:
            if error.errno != errno.ENOTCONN:
                raise
        chunks = []
        while True:
            try:
                data = stream.recv(65536)
            except ConnectionResetError:
                break
            if not data:
                break
            chunks.append(data)
            if b'\n' in data:
                break
        return json.loads(b''.join(chunks)) if chunks else {'error': 'connection_closed'}


def stop(pid):
    os.kill(pid, signal.SIGKILL)
    owned_pids.discard(pid)
    time.sleep(0.15)


try:
    with tempfile.TemporaryDirectory(prefix='mm-launch-', dir='/tmp') as directory:
        base = Path(directory)
        root = base / 'runtime'
        files = base / 'files'
        files.mkdir()
        for name in ['a.md', '中文 notes.md', '-leading.md']:
            (files / name).write_bytes(b'# source\r\n\r\nUnchanged bytes.\r\n')
        (files / 'alias.md').symlink_to(files / 'a.md')
        before = {p: p.read_bytes() for p in files.iterdir()}
        code, response, cold = invoke(root, ['a.md', '中文 notes.md', '-leading.md'], files)
        check('cold bundled executable / cwd / Unicode / spaces / leading hyphen',
              code == 0 and [r['status'] for r in response['results']] == ['opened'] * 3)
        pid = response['pid']
        code, response, warm = invoke(root, [files / 'alias.md', files / 'missing', files])
        check('warm reuse / alias deduplication / partial failure / directory rejection',
              code == 1 and response['pid'] == pid and
              [r['status'] for r in response['results']] == ['already_open', 'error', 'error'])
        check('file failures carry stable codes and readable messages',
              response['results'][1]['error'] == 'file_not_found' and
              response['results'][2]['error'] == 'not_supported_file' and
              all(isinstance(result.get('message'), str) and result['message']
                  for result in response['results'][1:]))
        check('incomplete onboarding accompanies admission', response['onboarding_needed'])
        invalid = wire(root, b'{"version":999,"paths":[]}\n')
        check('incompatible protocol rejected', invalid['error'] == 'incompatible_version')
        check('malformed request rejected', wire(root, b'not json\n')['error'] == 'invalid_request')
        check('oversized frame bounded', wire(root, b'x' * 65537 + b'\n')['error'] in ['invalid_request', 'connection_closed'])
        check('unterminated frame rejected', wire(root, b'{}')['error'] == 'invalid_request')
        fifo = files / 'pipe'
        os.mkfifo(fifo)
        code, response, _ = invoke(root, [fifo])
        check('FIFO rejected without blocking', code == 1 and
              response['results'][0]['error'] == 'not_supported_file')
        inaccessible = files / 'private'
        inaccessible.write_text('private')
        inaccessible.chmod(0)
        code, response, _ = invoke(root, [inaccessible])
        check('unreadable file rejected', code == 1 and
              response['results'][0]['error'] == 'permission_denied' and
              bool(response['results'][0].get('message')))
        inaccessible.chmod(0o600)
        bad = os.fsencode(files) + b'/bad-\xff.md'
        code, response, _ = invoke(root, [os.fsdecode(bad)])
        check('unrepresentable filename rejected without substitution', code == 2)
        stop(pid)
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            runs = list(pool.map(lambda _: invoke(root, [files / 'a.md']), range(6)))
        check('concurrent cold starts and stale socket recovery keep one owner',
              all(r[0] == 0 for r in runs) and len({r[1]['pid'] for r in runs}) == 1 and
              sum(r[1]['results'][0]['status'] == 'opened' for r in runs) == 1)
        stop(runs[0][1]['pid'])
        delayed_root = base / 'delayed'
        code, response, elapsed = invoke(delayed_root, [files / 'a.md'],
                                         extra={'MM_LAUNCH_CHECK_UI_DELAY_MS': '5000'})
        check('admission succeeds before delayed window creation', code == 0 and elapsed < 4)
        stop(response['pid'])
        drop_root = base / 'drop'
        code, _, _ = invoke(drop_root, [files / 'a.md'], extra={'MM_LAUNCH_CHECK_DROP_REPLY': '1'})
        check('lost response reports unknown outcome', code == 3)
        code, response, _ = invoke(drop_root, [files / 'a.md'])
        check('retry after lost response reuses admitted file',
              code == 0 and response['results'][0]['status'] == 'already_open')
        stop(response['pid'])
        public = base / 'public'
        public.mkdir(mode=0o755)
        run = subprocess.run([binary, 'open', '--', str(files / 'a.md')],
                             env=dict(os.environ, MM_LAUNCH_CHECK_DIR=str(public)), capture_output=True)
        check('nonprivate endpoint directory rejected', run.returncode == 2)
        link = base / 'link'
        link.symlink_to(root)
        run = subprocess.run([binary, 'open', '--', str(files / 'a.md')],
                             env=dict(os.environ, MM_LAUNCH_CHECK_DIR=str(link)), capture_output=True)
        check('symlink endpoint directory rejected', run.returncode == 2)
        stalled = base / 'stalled'
        stalled.mkdir(mode=0o700)
        with socket.socket(socket.AF_UNIX) as listener:
            listener.bind(str(stalled / 'launch.sock'))
            listener.listen()
            def hold_response():
                with listener.accept()[0] as connection:
                    connection.recv(65536)
                    time.sleep(11)
            thread = threading.Thread(target=hold_response)
            thread.start()
            code, response, elapsed = invoke(stalled, [files / 'a.md'])
            thread.join()
        check('unresponsive peer reaches bounded unknown outcome',
              code == 3 and 9 <= elapsed < 13)
        check('document bytes unchanged', all(p.read_bytes() == data for p, data in before.items()))
        print(json.dumps({'passed': results, 'cold_seconds': cold, 'warm_seconds': warm}, indent=2))
finally:
    for pid in owned_pids:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
