"""Replays the host's save I/O sequence (desktop/src/files.rs `write`) on a scratch copy of a fixture
with F_FULLFSYNC, fsync and no sync: canonicalize and open, read and SHA-256 the base, write and
truncate, sync, read and SHA-256 the result. Prints medians of 7 saves in ms. Needs no app build.

Usage: python3 tools/perf/app/save_io.py <fixture>..., e.g. save_io.py small.md p600.md"""
import fcntl, hashlib, os, shutil, statistics, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import FIXTURES, RUNS, PERF
import subprocess


def snapshot(fd, path):
    os.lseek(fd, 0, 0); data = b''
    while chunk := os.read(fd, 1 << 20): data += chunk
    os.path.realpath(path); fd2 = os.open(path, os.O_RDONLY); os.fstat(fd2); os.close(fd2)
    return data, hashlib.sha256(data).hexdigest()


def save(path, content, sync):
    t = {}; t0 = time.perf_counter()
    os.path.realpath(path); fd = os.open(path, os.O_RDWR)
    base, _ = snapshot(fd, path); t['base_read_hash'] = time.perf_counter() - t0
    _ = base.decode('utf-8', 'replace') == content.decode()
    t1 = time.perf_counter(); os.lseek(fd, 0, 0); os.write(fd, content); os.ftruncate(fd, len(content)); t['write'] = time.perf_counter() - t1
    t2 = time.perf_counter()
    if sync == 'full': fcntl.fcntl(fd, fcntl.F_FULLFSYNC)
    elif sync == 'fsync': os.fsync(fd)
    t['sync'] = time.perf_counter() - t2
    t3 = time.perf_counter(); data, _ = snapshot(fd, path); _ = data.decode() == content.decode(); t['readback'] = time.perf_counter() - t3
    os.close(fd); t['total'] = time.perf_counter() - t0
    return {k: v * 1000 for k, v in t.items()}


subprocess.run(['node', os.path.join(PERF, 'fixtures.mjs')], check=True, stdout=subprocess.DEVNULL)
os.makedirs(RUNS, exist_ok=True)
for name in sys.argv[1:]:
    path = os.path.join(RUNS, 'save-' + name)
    shutil.copyfile(os.path.join(FIXTURES, name), path)
    original = open(path, 'rb').read()
    for sync in ['full', 'fsync', 'none']:
        rows = [save(path, original[:-10] + f'edit{i:06d}'.encode(), sync) for i in range(7)]
        print(name, len(original), sync, {k: round(statistics.median(r[k] for r in rows), 2) for k in rows[0]})
    os.remove(path)
