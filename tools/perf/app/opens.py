"""Cold, warm, large and restored opens of the packaged app. Prints the median of each timing and
writes every row to tools/perf/results/<section>.json.

Usage: python3 tools/perf/app/opens.py [baseline] [cold] [colddelay] [warm] [large] [restore]"""
import json, os, statistics, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import *

SECTIONS = ['baseline', 'cold', 'colddelay', 'warm', 'large', 'restore']
sections = sys.argv[1:] or SECTIONS
unknown = set(sections) - set(SECTIONS)
if unknown: sys.exit(f'unknown sections {sorted(unknown)}; choose from {SECTIONS}')
prepare()


def timed(cmd, n=10):
    xs = []
    for _ in range(n):
        t = time.monotonic(); subprocess.run(cmd, capture_output=True); xs.append((time.monotonic() - t) * 1000)
    return xs


def med(rows, key):
    xs = [r[key] for r in rows if r.get(key) is not None]
    return round(statistics.median(xs), 1) if xs else None


def save(name, rows):
    for r in rows: r.pop('series', None)
    json.dump(rows, open(os.path.join(RESULTS, f'{name}.json'), 'w'), indent=1)
    keys = [k for k in rows[0] if k.endswith('_ms') or k.endswith('_mb')]
    print(name, {k: med(rows, k) for k in keys}, flush=True)


def warm_host(run):
    """Starts a host on small.md and returns its pid and the WebKit processes it brought up."""
    fresh(run)
    pre = webcontent_pids()
    first = open_files(run, [fixture('small.md')], via='binary', title='small.md'); time.sleep(3)
    return first['pid'], webcontent_pids() - pre


if 'baseline' in sections:
    rows = [{'node_empty_ms': a, 'launcher_usage_ms': b, 'binary_usage_ms': c} for a, b, c in zip(
        timed(['node', '-e', '']), timed(['node', os.path.join(REPO, 'bin/mastermind.js')]), timed([BIN, 'open']))]
    save('baseline', rows)

if 'cold' in sections:
    for via in ['node', 'binary']:
        rows = []
        for _ in range(5):
            run = run_dir(f'cold-{via}'); fresh(run)
            m = open_files(run, [fixture('small.md')], via=via, title='small.md', window=True, sample_s=5)
            rows.append(m); kill(m['pid'])
        save(f'cold-{via}', rows)

if 'colddelay' in sections:
    rows = []
    for _ in range(5):
        run = run_dir('cold-delay'); fresh(run)
        m = open_files(run, [fixture('small.md')], via='binary', extra={'MM_LAUNCH_CHECK_UI_DELAY_MS': '5000'})
        rows.append(m); kill(m['pid'])
    save('cold-delay', rows)

if 'warm' in sections:
    run = run_dir('warm')
    pid, wk = warm_host(run)
    for via in ['node', 'binary']:
        save(f'warm-already-{via}', [open_files(run, [fixture('small.md')], via=via, host_pid=pid) for _ in range(5)])
    rows = [open_files(run, [fixture('small.md', i)], via='node', title=f'small_{i}.md', sample_s=3, host_pid=pid, webkit=wk)
            for i in range(1, 6)]
    save('warm-new-small', rows)
    kill(pid)

if 'large' in sections:
    for name, sample in [('k600', 6), ('m15', 20)]:
        run = run_dir(f'large-{name}')
        pid, wk = warm_host(run)
        rows = []
        for i in range(1, 6):
            m = open_files(run, [fixture(f'{name}.md', i)], via='node', title=f'{name}_{i}.md', sample_s=sample, host_pid=pid, webkit=wk)
            m['webkit_footprint_mb'] = round(sum(u['footprint_mb'] for u in map(rusage.usage, wk) if u))
            m['host_footprint_mb'] = round(rusage.usage(pid)['footprint_mb'])
            rows.append(m)
        save(f'large-{name}', rows)
        kill(pid)

if 'restore' in sections:
    for label, remembered in [('restore-p600', [fixture('p600.md', 1)]), ('restore-p15', [fixture('p15.md', 1)]),
                              ('restore-6x15MiB', [fixture('m15.md', i) for i in range(1, 7)])]:
        rows = []
        for _ in range(5):
            run = run_dir(label); fresh(run); env_for(run)
            json.dump({'version': 1, 'files': [os.path.realpath(p) for p in remembered], 'active': None},
                      open(os.path.join(run, 'prefs.open-files.json'), 'w'))
            m = open_files(run, [fixture('small.md')], via='binary', title='small.md', window=True, sample_s=6)
            rows.append(m); kill(m['pid'])
        save(label, rows)
