"""Measure launcher invocation to observed document-layout readiness on macOS."""
import hashlib
import json
import os
from pathlib import Path
import signal
import statistics
import subprocess
import sys
import tempfile
import time
import uuid

TRIALS = 5
POLL_INTERVAL_SECONDS = 0.005
READINESS_DEADLINE_SECONDS = 30


def stop(pid):
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.05)
    os.kill(pid, signal.SIGKILL)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.05)
    raise AssertionError(('host did not exit', pid))


def admitted_host_pid(response, launcher_pid, fixture):
    pid = response['pid']
    assert isinstance(pid, int) and not isinstance(pid, bool) and pid > 0, response
    assert pid != launcher_pid, response
    assert len(response['results']) == 1, response
    result = response['results'][0]
    assert result['status'] == 'opened' and result['canonical'] == str(fixture), response
    return pid


def trial(binary, fixture, root):
    nonce = uuid.uuid4().hex
    output = root / 'ready.json'
    preferences = root / 'preferences.json'
    preferences.write_text(json.dumps({'onboardingCompleted': True, 'authorTag': 'Readiness',
                                      'uiLang': 'en'}), encoding='utf-8')
    config = {'nonce': nonce, 'target': str(fixture), 'output': str(output)}
    environment = dict(os.environ, MM_LAUNCH_CHECK_DIR=str(root / 'runtime'),
                       MM_LAUNCH_CHECK_PREFERENCES=str(preferences),
                       MM_LAUNCH_CHECK_READY_TRACE=json.dumps(config))
    environment.pop('MM_LAUNCH_CHECK_UI_DELAY_MS', None)
    environment.pop('MM_LAUNCH_CHECK_DROP_REPLY', None)
    pid = None
    process = None
    response = None
    started = time.monotonic()
    try:
        process = subprocess.Popen([str(binary), 'open', '--', str(fixture)],
                                   env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        deadline = started + READINESS_DEADLINE_SECONDS
        record = None
        while time.monotonic() < deadline:
            try:
                candidate = json.loads(output.read_bytes())
            except (FileNotFoundError, json.JSONDecodeError):
                candidate = None
            if candidate is not None:
                assert candidate.get('nonce') == nonce, ('unexpected trace nonce', candidate)
                assert candidate.get('target') == str(fixture), ('unexpected trace target', candidate)
                assert candidate.get('stage') == 'document_layout_two_frames', candidate
                record = candidate
                observed = time.monotonic()
                break
            if process.poll() not in (None, 0):
                raise AssertionError(('launcher failed', process.returncode))
            time.sleep(POLL_INTERVAL_SECONDS)
        if record is None:
            if process.poll() is None:
                process.kill()
            stdout, stderr = process.communicate(timeout=5)
            raise AssertionError(('document-layout readiness deadline; no valid signal observed',
                                  stdout.decode('utf-8', errors='replace'),
                                  stderr.decode('utf-8', errors='replace')))
        stdout, stderr = process.communicate(timeout=5)
        response = json.loads(stdout)
        assert process.returncode == 0, (response, stderr)
        pid = admitted_host_pid(response, process.pid, fixture)
        assert record['pid'] == pid, (record, response)
        assert len(response['results']) == 1, response
        assert response['results'][0]['status'] == 'opened', response
        assert response['results'][0]['canonical'] == str(fixture), response
        assert record['session_id'] == '0', record
        return {'seconds': observed - started, 'host_pid': pid, 'launcher_pid': process.pid,
                'trace': record}
    finally:
        if process is not None:
            if process.poll() is None:
                process.kill()
            stdout, _ = process.communicate(timeout=5)
            if pid is None:
                try:
                    response = json.loads(stdout)
                    pid = admitted_host_pid(response, process.pid, fixture)
                except (json.JSONDecodeError, AssertionError, KeyError, TypeError):
                    pass
        if pid is not None:
            stop(pid)


def main():
    if sys.platform != 'darwin':
        raise SystemExit('This measurement harness currently supports macOS only.')
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 measure-readiness.py /path/to/packaged/executable')
    binary = Path(sys.argv[1]).resolve(strict=True)
    public_fixture = Path(__file__).parent / 'fixtures' / 'readiness.md'
    original = public_fixture.read_bytes()
    with tempfile.TemporaryDirectory(prefix='mm-readiness-', dir='/tmp') as directory:
        root = Path(directory).resolve()
        fixture = root / 'readiness.md'
        fixture.write_bytes(original)
        runs = []
        for index in range(TRIALS):
            run_root = root / str(index)
            run_root.mkdir()
            runs.append(trial(binary, fixture, run_root))
            assert fixture.read_bytes() == original, 'measurement changed document bytes'
        seconds = [run['seconds'] for run in runs]
        print(json.dumps({
            'metric': 'launcher_invocation_to_observed_document_layout_two_frames',
            'binary': str(binary), 'binary_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
            'fixture_sha256': hashlib.sha256(original).hexdigest(), 'fixture_bytes': len(original),
            'poll_interval_seconds': POLL_INTERVAL_SECONDS, 'fresh_process_trials': runs,
            'median_seconds': statistics.median(seconds), 'min_seconds': min(seconds),
            'max_seconds': max(seconds),
        }, indent=2))


if __name__ == '__main__':
    main()
