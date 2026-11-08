"""Cold open of one fixture with a once-per-second trace of cumulative host and WebKit CPU, plus
footprints at the end. Writes the full 20 ms series to tools/perf/results/timeline-<fixture>.json.

Usage: python3 tools/perf/app/timeline.py <fixture> <seconds>, e.g. timeline.py p600.md 25"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import *

name, secs = sys.argv[1], float(sys.argv[2])
prepare()
run = run_dir('timeline-' + name.replace('.md', '')); fresh(run)
pre = webcontent_pids()
m = open_files(run, [fixture(name)], via='binary', title=name, window=True, sample_s=secs)
try:
    wk = webcontent_pids() - pre
    s = m.pop('series')
    print({k: (round(v) if isinstance(v, float) else v) for k, v in m.items()})
    print('webkit footprint MB', round(sum((rusage.usage(p) or {'footprint_mb': 0})['footprint_mb'] for p in wk)),
          'host MB', round(rusage.usage(m['pid'])['footprint_mb']))
    prev = None
    for row in s:
        if prev is None or row[0] - prev[0] >= 1000:
            print(f't={row[0] / 1000:6.1f}s host={row[1]:8.0f} webkit={row[2]:8.0f}'); prev = row
    json.dump({'marks': m, 'series': s}, open(os.path.join(RESULTS, f'timeline-{name}.json'), 'w'))
finally:
    kill(m['pid'])
