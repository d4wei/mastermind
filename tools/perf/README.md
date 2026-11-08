# Performance benches

Measures the renderer, the document core and the packaged macOS app against fixed fixtures, so an
audit can compare its numbers with earlier ones. Nothing here runs under `npm test`. Each bench is
its own `npm run perf:*` script; run them one at a time on an otherwise idle machine.

[`baselines.json`](baselines.json) holds the SHA-256 of every fixture and, per audit, the before and
after medians with the commits they were measured at.

## Fixtures

`npm run perf:fixtures` writes any missing fixture into `fixtures/` (git-ignored) and checks every
fixture against `baselines.json`. The other benches generate what they need on first use.
[`fixtures.mjs`](fixtures.mjs) is deterministic: a fixed-seed generator for the review documents and
size-exact repetition for the rest.

| Fixture | Size | Content | Used by |
|---|---|---|---|
| `mid.md` | 63 KiB | front matter, prose, tables, code, lists, CJK; 40 comment threads with replies, 30 suggestions | document, session |
| `large.md` | 626 KiB | the same shape with 300 threads and 220 suggestions | document, session |
| `small.md` | 28 B | one insertion | app |
| `k600.md`, `m15.md` | 600 KiB, 15 MiB | a highlighted comment in every paragraph | app (`large`, `restore`) |
| `p600.md`, `p15.md` | 600 KiB, 15 MiB | plain prose, one comment per 100 blocks | app (`restore`, idle, timeline, save) |

## Benches

### `npm run perf:document`

[`document.bench.mts`](document.bench.mts) times `document/` and the pure `ui/` helpers in Node on
`mid.md` and `large.md`, as the reading surface calls them: the analysis pipeline stage by stage,
accepting a mark, reply and comment verdicts per composer keystroke, thread identity after an
external change, and Find's matching. Prints medians in ms. Takes about 70 s.

### `npm run perf:session`

[`session/run.mjs`](session/run.mjs) builds [`session/entry.tsx`](session/entry.tsx) with Vite as a
production bundle using React's profiling build, loads it with `mid.md` and `large.md` in headless
Chrome over the DevTools protocol, and prints what the page measured: mount, hovering an anchor,
selecting a thread, reply keystrokes until the deferred verdict lands, Escape, selection mapping,
Find keystrokes, a review edit and its undo, mode switches and a Markdown-mode keystroke. Times are
wall-clock ms; "profiler actual" is React's render time. The full result is written to
`results/session-<commit>.json`; the commit gains `+dirty` when `ui/` or `document/` has
uncommitted changes. Takes about 15 s.

Needs Node 22 or later (for the global `WebSocket`) and Google Chrome. It looks for Chrome at
`CHROME_PATH`, then the standard macOS and Linux locations; set `CHROME_PATH` to any Chrome or
Chromium binary, such as one Playwright downloaded. No browser package is a project dependency.

### `npm run perf:app` (macOS)

[`app/opens.py`](app/opens.py) drives the packaged app through the launcher and times opens. Build
first with `npm run desktop:build`. Pass section names to run a subset, e.g.
`npm run perf:app -- cold warm`:

- `baseline`: process start of `node`, the launcher's usage output, and the binary's.
- `cold`: a first open of `small.md`, through `bin/mastermind.js` and through the binary: the
  launcher's reply, the endpoint socket appearing, the first window, the titled window, and host
  and WebKit CPU over 5 s.
- `colddelay`: the cold reply when the window is held back 5 s (`MM_LAUNCH_CHECK_UI_DELAY_MS`).
- `warm`: reopening an open file, and opening new small files into a running host.
- `large`: opening `k600.md` and `m15.md` copies into a running host: titled window, CPU until
  settled, and host and WebKit footprints.
- `restore`: a cold start whose remembered files are `p600.md`, `p15.md`, or six 15 MiB files.

Each section prints medians of five runs and writes every row to `results/<section>.json`.

[`app/harness.py`](app/harness.py) gives each run its own preferences file under `.runs/<run>/` and
its own endpoint directory under `/private/tmp/mmp/<run>`, through the trusted harness controls
`MM_LAUNCH_CHECK_PREFERENCES` and `MM_LAUNCH_CHECK_DIR`. The endpoint is a Unix socket, and
`sun_path` holds 104 bytes, so it cannot live under the checkout. The user's own host, preferences
and remembered files are untouched, and every host the harness starts is killed when its
measurement ends. Windows appear on screen while it runs. Window timings come from
[`app/winwatch.swift`](app/winwatch.swift), compiled on first use into `.build/`; CPU, wakeups and
footprints from `proc_pid_rusage` in [`app/rusage.py`](app/rusage.py). Needs Python 3 and the Xcode
command-line tools.

### `npm run perf:app:idle -- <fixture> <settle_s>` (macOS)

[`app/idle.py`](app/idle.py) opens a fixture, waits `settle_s`, then reports host and WebKit CPU and
wakeups per second over 30 quiet seconds, and again while a sibling file in the document's directory
is rewritten 50 times.

### `npm run perf:app:timeline -- <fixture> <seconds>` (macOS)

[`app/timeline.py`](app/timeline.py) cold-opens one fixture and prints cumulative host and WebKit
CPU once a second, with footprints at the end. The 20 ms series goes to `results/`.

### `npm run perf:app:save -- <fixture>...`

[`app/save_io.py`](app/save_io.py) replays the I/O sequence of a save in
[`desktop/src/files.rs`](../../desktop/src/files.rs) on a scratch copy, with `F_FULLFSYNC`, `fsync`
and no sync, and prints the medians of seven saves. It needs no app build.

## Example output

Recorded on 2026-11-07 at `fa76cd6` on an Apple M1 Pro, macOS 26.6, Node 24.18, one run each.

`npm run perf:document` (medians, ms):

```text
┌────────────────────────────────────────────────────────────┬─────────┬──────────┐
│ (index)                                                    │ mid     │ large    │
├────────────────────────────────────────────────────────────┼─────────┼──────────┤
│ analyzeMarkdown (total)                                    │ '67.72' │ '711.36' │
│   parseMarkdown plain                                      │ '31.45' │ '337.84' │
│   scanMarkdownTree                                         │ '1.51'  │ '14.12'  │
│   pickSentinels+maskSource                                 │ '1.62'  │ '18.32'  │
│   parseMarkdown masked                                     │ '27.95' │ '322.07' │
│   recordProvenance+criticTransform                         │ '2.52'  │ '14.70'  │
│   group+threadCards                                        │ '0.07'  │ '0.50'   │
│ parseResolvedThreads (per source change)                   │ '30.51' │ '330.48' │
│ extractOutline(analysis.tree)                              │ '0.02'  │ '0.12'   │
│ commentFootnotes parseAuthor                               │ '0.02'  │ '0.11'   │
│ calloutSections+plainText (per MarkdownView render)        │ '0.03'  │ '0.13'   │
│ accept one mark: splice only                               │ '0.00'  │ '0.00'   │
│ accept one mark: splice + analyzeMarkdown                  │ '63.51' │ '706.98' │
│ replyEdits verify (per composer keystroke)                 │ '66.92' │ '705.13' │
│   of which readingShape(original)                          │ '0.87'  │ '10.17'  │
│ commentBodyFits (per render)                               │ '0.06'  │ '0.13'   │
│ commentVerdict new comment (per keystroke)                 │ '65.63' │ '752.63' │
│ resolveThreadEdits                                         │ '32.61' │ '349.89' │
│ post reply: splice + analyzeMarkdown                       │ '63.82' │ '697.08' │
│ locateThread x3 (active/hover/focus) after external change │ '3.51'  │ '35.33'  │
│ refreshReplies 5 drafts after external change              │ '5.96'  │ '58.97'  │
│ locateThread unchanged source (per render x3)              │ '0.00'  │ '0.00'   │
│ Find comment-body matches "review" (per keystroke)         │ '0.10'  │ '0.68'   │
│ Find textMatches over whole source "review"                │ '5.08'  │ '49.48'  │
└────────────────────────────────────────────────────────────┴─────────┴──────────┘
```

`npm run perf:session` (selected rows; the full table has about 70):

```text
commit fa76cd6
┌───────────────────────────────────────────────────────────────────────────────┬─────────┬─────────┐
│ (index)                                                                       │ mid     │ large   │
├───────────────────────────────────────────────────────────────────────────────┼─────────┼─────────┤
│ mount: sync ms                                                                │ '147.1' │ '891.8' │
│ DOM elements                                                                  │ '3386'  │ '31569' │
│ rail cards                                                                    │ '40'    │ '300'   │
│ hover anchor: dispatch..next task ms (median of 6)                            │ '4.9'   │ '5.0'   │
│ click anchor (select thread): sync ms                                         │ '5.7'   │ '7.9'   │
│ reply keystroke "O": until deferred verdict done ms                           │ '18.8'  │ '17.5'  │
│ reply keystroke "OK": until deferred verdict done ms                          │ '16.0'  │ '17.8'  │
│ mapSelection one paragraph (first call builds index) ms                       │ '2.8'   │ '11.7'  │
│ Find keystroke "review": sync ms                                              │ '1.7'   │ '6.0'   │
│ click deletion (review edit): sync ms                                         │ '76.3'  │ '748.8' │
│ undo: sync ms                                                                 │ '77.1'  │ '758.4' │
│ mode -> Markdown: sync ms                                                     │ '6.8'   │ '310.6' │
│ Markdown-mode keystroke (dispatch + store + React + next task) ms median of 3 │ '6.9'   │ '7.5'   │
│ mode -> Read: sync ms                                                         │ '106.4' │ '914.9' │
└───────────────────────────────────────────────────────────────────────────────┴─────────┴─────────┘
```

`npm run perf:app` (medians of five, ms or MB; `cold` and `restore` from a second run):

```text
baseline {'node_empty_ms': 39.7, 'launcher_usage_ms': 39.1, 'binary_usage_ms': 9.5}
cold-node {'socket_ms': 52.8, 'reply_ms': 167.3, 'window_ms': 424, 'title_ms': 589, 'host_cpu_ms': 288, 'webkit_cpu_ms': 375, 'webkit_settle_ms': 1489.8, 'host_settle_ms': 626.9}
cold-binary {'socket_ms': 16.5, 'reply_ms': 124.4, 'window_ms': 387, 'title_ms': 566, 'host_cpu_ms': 288, 'webkit_cpu_ms': 377, 'webkit_settle_ms': 1133.0, 'host_settle_ms': 590.8}
cold-delay {'socket_ms': 31.6, 'reply_ms': 147.5}
warm-already-node {'reply_ms': 45.0}
warm-already-binary {'reply_ms': 8.7}
warm-new-small {'reply_ms': 57.5, 'title_ms': 65, 'host_cpu_ms': 17, 'webkit_cpu_ms': 59, 'webkit_settle_ms': 91.7, 'host_settle_ms': 68.4}
large-k600 {'reply_ms': 59.8, 'title_ms': 1515, 'host_cpu_ms': 66, 'webkit_cpu_ms': 4995, 'webkit_settle_ms': 4519.5, 'host_settle_ms': 2326.4, 'webkit_footprint_mb': 1201, 'host_footprint_mb': 28}
large-m15 {'reply_ms': 194.0, 'title_ms': 332, 'host_cpu_ms': 320, 'webkit_cpu_ms': 22989, 'webkit_settle_ms': 20009.8, 'host_settle_ms': 1788.0, 'webkit_footprint_mb': 9449, 'host_footprint_mb': 62}
restore-p600 {'socket_ms': 16.7, 'reply_ms': 134.6, 'window_ms': 415, 'title_ms': 587, 'host_cpu_ms': 300, 'webkit_cpu_ms': 399, 'webkit_settle_ms': 5675.8, 'host_settle_ms': 609.4}
restore-p15 {'socket_ms': 16.3, 'reply_ms': 176.0, 'window_ms': 399, 'title_ms': 572, 'host_cpu_ms': 349, 'webkit_cpu_ms': 406, 'webkit_settle_ms': 1465.8, 'host_settle_ms': 607.5}
restore-6x15MiB {'socket_ms': 16.3, 'reply_ms': 205.4, 'window_ms': 415, 'title_ms': 579, 'host_cpu_ms': 660, 'webkit_cpu_ms': 403, 'webkit_settle_ms': 5661.2, 'host_settle_ms': 616.6}
```

`npm run perf:app:idle -- p600.md 8`, `perf:app:timeline -- p600.md 15` (first seconds) and `perf:app:save -- small.md p600.md`:

```text
p600.md idle 30s {'host_cpu_ms_per_s': 2.23, 'host_wakeups_per_s': 6.6, 'webkit_cpu_ms_per_s': 4.11, 'webkit_wakeups_per_s': 10.3, 'webkit_footprint_mb': 189}
p600.md 50 sibling writes over 5 s (+2 s) {'host_cpu_ms_per_s': 2.62, 'host_wakeups_per_s': 4.0, 'webkit_cpu_ms_per_s': 2.86, 'webkit_wakeups_per_s': 6.3, 'webkit_footprint_mb': 189}
{'socket_ms': 18, 'reply_ms': 134, 'status': ['opened'], 'pid': 43156, 'window_ms': 405, 'title_ms': 594, 'host_cpu_ms': 331, 'webkit_cpu_ms': 2248, 'webkit_settle_ms': 11686, 'host_settle_ms': 1686}
webkit footprint MB 197 host MB 32
t=   0.0s host=       0 webkit=       0
t=   1.0s host=     284 webkit=    1066
t=   2.1s host=     310 webkit=    2132
t=   3.1s host=     313 webkit=    2190
t=   4.1s host=     313 webkit=    2204
small.md 28 full {'base_read_hash': 0.08, 'write': 0.02, 'sync': 4.77, 'readback': 0.07, 'total': 4.96}
small.md 28 fsync {'base_read_hash': 0.07, 'write': 0.01, 'sync': 0.03, 'readback': 0.04, 'total': 0.15}
small.md 28 none {'base_read_hash': 0.07, 'write': 0.01, 'sync': 0.0, 'readback': 0.03, 'total': 0.12}
p600.md 614400 full {'base_read_hash': 0.47, 'write': 0.05, 'sync': 3.92, 'readback': 0.59, 'total': 5.29}
p600.md 614400 fsync {'base_read_hash': 0.42, 'write': 0.03, 'sync': 0.14, 'readback': 0.54, 'total': 1.24}
p600.md 614400 none {'base_read_hash': 0.44, 'write': 0.03, 'sync': 0.0, 'readback': 0.46, 'total': 1.07}
```
