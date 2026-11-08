"""Idle cost of an open document: host and WebKit CPU and wakeups over 30 quiet seconds, then while
a sibling file in the watched directory is rewritten 50 times, 100 ms apart.

Usage: python3 tools/perf/app/idle.py <fixture> <settle_s>, e.g. idle.py p600.md 8"""
import os, shutil, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import *

name, settle_s = sys.argv[1], float(sys.argv[2])
prepare()
# A directory of its own, so sibling writes reach only this document's watcher.
folder = os.path.join(RUNS, 'idle-docs')
os.makedirs(folder, exist_ok=True)
doc = os.path.join(folder, name)
shutil.copyfile(fixture(name), doc)
run = run_dir('idle-' + name.replace('.md', '')); fresh(run)
pre = webcontent_pids()
m = open_files(run, [doc], via='binary', title=name)
time.sleep(settle_s)
pids = [m['pid']] + sorted(webcontent_pids() - pre)


def snap(): return {p: rusage.usage(p) for p in pids}


def diff(a, b, secs):
    host, h0 = b[pids[0]], a[pids[0]]
    wk = [(a[p], b[p]) for p in pids[1:] if a[p] and b[p]]
    return {'host_cpu_ms_per_s': round((host['cpu_ms'] - h0['cpu_ms']) / secs, 2),
            'host_wakeups_per_s': round((host['wakeups'] - h0['wakeups']) / secs, 1),
            'webkit_cpu_ms_per_s': round(sum(y['cpu_ms'] - x['cpu_ms'] for x, y in wk) / secs, 2),
            'webkit_wakeups_per_s': round(sum(y['wakeups'] - x['wakeups'] for x, y in wk) / secs, 1),
            'webkit_footprint_mb': round(sum(y['footprint_mb'] for x, y in wk))}


try:
    a = snap(); time.sleep(30); b = snap()
    print(name, 'idle 30s', diff(a, b, 30), flush=True)
    sibling = os.path.join(folder, 'sibling.txt')
    a = snap()
    for i in range(50):
        open(sibling, 'w').write(str(i)); time.sleep(0.1)
    time.sleep(2); b = snap()
    print(name, '50 sibling writes over 5 s (+2 s)', diff(a, b, 7), flush=True)
    os.remove(sibling)
finally:
    kill(m['pid'])
