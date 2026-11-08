"""Times launcher opens of the packaged macOS app against an isolated host.

Each run gets its own preferences file under tools/perf/.runs/<run>/ and its own endpoint directory
under /private/tmp/mmp/<run>: the endpoint is a Unix socket, and sun_path holds 104 bytes, so it
cannot live under a deep checkout path. The user's own host, preferences and remembered files are
never touched. Every process the harness launches is killed by pid when its measurement ends."""
import json, os, shutil, signal, subprocess, sys, threading, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rusage

APP = os.path.dirname(os.path.abspath(__file__))
PERF = os.path.dirname(APP)
REPO = os.path.dirname(os.path.dirname(PERF))
FIXTURES = os.path.join(PERF, 'fixtures')
RUNS = os.path.join(PERF, '.runs')
RESULTS = os.path.join(PERF, 'results')
BUILD = os.path.join(PERF, '.build')
BIN = os.path.join(REPO, 'desktop/target/release/bundle/macos/mastermind.app/Contents/MacOS/mastermind-launch-check')
WINWATCH = os.path.join(BUILD, 'winwatch')
ENDPOINT_ROOT = '/private/tmp/mmp'


def prepare():
    """Checks the packaged app, writes and verifies fixtures, and compiles the window watcher."""
    if not os.path.exists(BIN):
        sys.exit(f'missing {BIN}; run `npm run desktop:build` first')
    subprocess.run(['node', os.path.join(PERF, 'fixtures.mjs')], check=True, stdout=subprocess.DEVNULL)
    source = os.path.join(APP, 'winwatch.swift')
    if not os.path.exists(WINWATCH) or os.path.getmtime(WINWATCH) < os.path.getmtime(source):
        os.makedirs(BUILD, exist_ok=True)
        subprocess.run(['swiftc', '-O', source, '-o', WINWATCH], check=True)
    os.makedirs(RESULTS, exist_ok=True)


def fixture(name, n=None):
    """Path of a fixture, or of a distinct copy `<stem>_<n>.md` the host has not opened yet."""
    path = os.path.join(FIXTURES, name)
    if n is None: return path
    copy = os.path.join(FIXTURES, name.replace('.md', f'_{n}.md'))
    if not os.path.exists(copy): shutil.copyfile(path, copy)
    return copy


def run_dir(name):
    return os.path.join(RUNS, name)


def rt_dir(run):
    return os.path.join(ENDPOINT_ROOT, os.path.basename(run))


def fresh(run):
    """Forgets a run's endpoint and remembered files so the next open starts a new host."""
    shutil.rmtree(rt_dir(run), ignore_errors=True)
    inventory = os.path.join(run, 'prefs.open-files.json')
    if os.path.exists(inventory): os.remove(inventory)


def env_for(run, extra=None):
    os.makedirs(run, exist_ok=True)
    prefs = os.path.join(run, 'prefs.json')
    if not os.path.exists(prefs):
        json.dump({'onboardingCompleted': True, 'authorTag': 'Perf', 'uiLang': 'en'}, open(prefs, 'w'))
    return dict(os.environ, MM_LAUNCH_CHECK_DIR=rt_dir(run), MM_LAUNCH_CHECK_PREFERENCES=prefs, **(extra or {}))


def webcontent_pids():
    out = subprocess.run(['pgrep', '-f', 'com.apple.WebKit'], capture_output=True, text=True).stdout
    return set(map(int, out.split()))


class Sampler(threading.Thread):
    """Samples cumulative CPU of the host and of WebKit processes that appeared after `before`."""
    def __init__(self, before, t0, host_pid=None, period=0.02):
        super().__init__(daemon=True); self.before = before; self.t0 = t0; self.host = host_pid
        self.period = period; self.series = []; self.stop_flag = False; self.pids = set(); self.fixed = None
    def run(self):
        n = 0
        while not self.stop_flag:
            if self.fixed: self.pids = self.fixed
            elif n % 10 == 0: self.pids = webcontent_pids() - self.before
            n += 1
            wk = sum((rusage.usage(p) or {'cpu_ms': 0})['cpu_ms'] for p in self.pids)
            h = (rusage.usage(self.host) or {'cpu_ms': 0})['cpu_ms'] if self.host else 0
            self.series.append(((time.monotonic() - self.t0) * 1000, h, wk))
            time.sleep(self.period)


def settle_ms(series, idx, slope=0.05):
    """Last sample time at which column `idx` rose faster than 20% of one core."""
    last_busy = None
    for i in range(1, len(series)):
        dt = series[i][0] - series[i - 1][0]
        if series[i][idx] - series[i - 1][idx] > slope * dt * 4:
            last_busy = series[i][0]
    return last_busy


def open_files(run, files, via='node', title=None, window=False, sample_s=0, extra=None, host_pid=None, webkit=None):
    """Opens `files` through the launcher and returns timings in ms from the launcher's start.

    via: 'node' runs bin/mastermind.js, 'binary' runs the bundled executable directly.
    title / window: wait for an on-screen window whose title contains `title` / any window.
    sample_s: sample host and WebKit CPU for this many seconds. host_pid / webkit: an already
    running host and its WebKit processes, for warm opens."""
    env = env_for(run, extra)
    before = webcontent_pids() if sample_s else set()
    sock = os.path.join(rt_dir(run), 'launch.sock')
    marks, watchers = {}, {}
    if window:
        watchers['window_ms'] = subprocess.Popen([WINWATCH, 'mastermind', '', '20'], stdout=subprocess.PIPE, text=True)
    if title:
        watchers['title_ms'] = subprocess.Popen([WINWATCH, 'mastermind', title, '20'], stdout=subprocess.PIPE, text=True)
    lead = 0.15 if watchers else 0  # watchers start polling before t0
    time.sleep(lead)
    cmd = (['node', os.path.join(REPO, 'bin/mastermind.js')] if via == 'node' else [BIN]) + ['open', '--', *files]
    t0 = time.monotonic()
    sampler = None
    if sample_s:
        sampler = Sampler(before, t0, host_pid)
        if webkit: sampler.fixed = set(webkit)
        sampler.start()
    proc = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    sock_seen = host_pid is not None or os.path.exists(sock)
    while proc.poll() is None:
        if not sock_seen and os.path.exists(sock):
            sock_seen = True; marks['socket_ms'] = (time.monotonic() - t0) * 1000
        time.sleep(0.0005)
    marks['reply_ms'] = (time.monotonic() - t0) * 1000
    out, err = proc.communicate()
    try:
        reply = json.loads(out)
    except json.JSONDecodeError:
        sys.exit(f'launcher reply was not JSON\nstdout: {out}\nstderr: {err}')
    marks['status'] = [r['status'] for r in reply['results']] or reply.get('error')
    marks['pid'] = reply.get('pid')
    if sampler: sampler.host = reply.get('pid')
    for key, w in watchers.items():
        _, ms = w.communicate()[0].split()
        marks[key] = int(ms) - int(lead * 1000) if ms != '-1' else None
    if sampler:
        while time.monotonic() - t0 < sample_s: time.sleep(0.05)
        sampler.stop_flag = True; sampler.join()
        s = sampler.series
        base = next((row for row in s if row[1] > 0), s[0]) if host_pid else (0, 0, 0)
        marks['host_cpu_ms'] = round(s[-1][1] - base[1])
        marks['webkit_cpu_ms'] = round(s[-1][2] - (s[0][2] if webkit else 0))
        marks['webkit_settle_ms'] = settle_ms(s, 2); marks['host_settle_ms'] = settle_ms(s, 1)
        marks['series'] = s
    return marks


def kill(pid):
    if not pid: return
    try: os.kill(pid, signal.SIGKILL)
    except ProcessLookupError: pass
    time.sleep(0.4)
