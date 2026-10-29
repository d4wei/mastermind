# Native validation

Tauri is the application host. This file retains dated observations from its validation and
adoption.
Earlier sections describe their measured builds, including the former diagnostic page; they are
not descriptions of the current default app. Correct factual errors or links in place; append new
measurements separately. The final section is the authoritative remaining hardening list.

## Environment and reproduction

Apple M1 Pro, arm64, macOS 26.6.2 (25G83), Rust/Cargo 1.98.0. Tauri 2.12.3, tauri-build 2.7.2,
Tauri CLI 2.12.2, and Interprocess 2.4.5 are pinned in the manifests and lockfiles here. The macOS
release bundle reported 10.91 MiB. It contains the diagnostic page, not the React reviewer.

Run the [desktop commands](README.md) against the packaged executable, not the unbundled Cargo
binary. [check-results.json](check-results.json) records one passing process run. Its cold and warm
timings measure subprocess start through admission acknowledgment; they are not first-paint or
review-ready times. They are single samples during concurrent build/testing activity, not a
performance benchmark. Dependencies were downloaded during setup; the running host uses local IPC.

## Observed on macOS

- The same bundled executable serves the short-lived command and GUI host roles. Terminal stdout
  contains one JSON result, with meaningful exit status for individual file failures.
- Relative paths use the caller's cwd. Spaces, Chinese filenames, and leading hyphens survive;
  symlink aliases reuse a canonical document. Invalid filename bytes are rejected before opening.
- Six simultaneous cold requests converge on one owning process and one newly admitted document.
  Killing a host leaves a stale socket; the next launch recovers under the lifetime lock.
- A dropped reply reports unknown outcome. Retrying returns the already-admitted document.
  A stalled peer reaches the launcher's deadline without killing the host or claiming rollback.
- Delaying native window creation still allows admission acknowledgment before a window exists.
  The renderer obtains retained state through its snapshot command.
- Bad protocol versions, malformed/unterminated frames, directories, pipes, and unreadable files
  are rejected. Oversized frames produce rejection or connection closure; callers must not assume
  malformed traffic always receives a structured error response.
- Publicly accessible and symlinked runtime directories are rejected. This tests local directory
  constraints, not isolation against a second OS user or a malicious same-user process.
- The native window and accessibility tree displayed the same two admitted paths as the launcher,
  including Chinese text. Command-Q terminated that test host. Initial automation attachment took
  unusually long; subsequent accessibility and screenshot reads completed promptly. Treat native
  automation reliability as an open check, not as measured application startup latency.
- Four Rust tests check initial bytes, retained snapshots, ordered partial success, invalid
  envelopes, and invalid file types. The process script checks document bytes remain unchanged.
  Rust lint with warnings denied passed. The existing app's tests, typechecks, and build also pass.

## Observed on Windows

[Hosted run 38209655085][windows-run] passed at source commit `e0cbf63` on Windows Server 2022
10.0.20348, runner image `20261004.326.1`, x64, with Rust 1.98.0. The workflow built an NSIS
installer, installed it, and exercised the installed executable. It did not run an uninstalled
development binary. [check-results-windows.json](check-results-windows.json) preserves the process
results; its timing samples are not a startup benchmark or comparable hardware to the macOS run.

- Seven Rust tests and lint with warnings denied passed, including Windows file identity, exclusive
  pipe ownership, endpoint release, and same-user connection checks.
- Thirteen process checks passed: cold/warm opening, Unicode paths, case aliases, ordered partial
  failure, a visible native window, protocol/frame rejection, concurrent starts after termination,
  admission before delayed window creation, lost replies and safe retry, and unchanged file bytes.
- Every opening request checks a result line, command exit, and closure of stdout/stderr pipes.
  Initial runs stalled because the GUI child inherited the launcher's captured pipes. The Windows
  spawn now disables handle inheritance; redirecting the child's own standard streams was not
  sufficient. The passing run keeps the app alive after the launcher and output pipes finish.
- A separate test created a temporary local account and confirmed that Windows denied it access
  to the running host's named pipe. Same-user access succeeded before the denial check. This is
  evidence for ordinary other-user denial, not isolation from administrators or malicious processes
  already running as the application user.

The window check establishes a visible window with the expected title. It does not establish
rendered document content, Chinese input, focus behavior, native dialogs, or interactive usability.
That initial diagnostic build had no editor, save operation, onboarding form, or production
preferences; later reviewer builds are recorded below.

## Remaining evidence and implementation gaps

### Windows support: implementation gaps, not a failed framework test

The initial Windows refusal came from our experiment's own guard, not a failed Tauri test.
The current [Windows endpoint](../../desktop/src/endpoint/windows.rs) implements named-pipe
ownership and access
checks, exercised in the hosted run above. The launcher transport uses Interprocess separately from
Tauri's webview bridge.

There are three different questions:

- **Ordinary file access is supported.** Tauri's [filesystem documentation][tauri-fs] covers
  Windows, macOS, and Linux, and directs Rust host code to `std::fs` or `tokio::fs`. Rust's
  [filesystem API][rust-fs] exposes cross-platform operations. Our source-preserving saves, external
  change detection, conflict checks, and save-aware quit remain application responsibilities.
  The native tests and reviewer checks below exercise those behaviors. Admission compares Windows
  volume/file IDs; the native unit test distinguishes identical-content files. Production
  replacement-race and broader watcher tests remain ahead.
- **Console behavior is a documented platform difference.** Tauri's [CLI documentation][tauri-cli]
  warns that production Windows GUI apps cannot write to the invoking console by default and links
  a workaround. Our installed console executable passes captured-output and exit-status tests;
  its spawned GUI child has no console. The experiment now separates the console launcher from the
  GUI executable; the updated installed-package checks pass in the run recorded below.
- **Endpoint permissions differ by OS.** Windows named pipes have
  [access-control rules][pipe-security] that differ from Unix socket-directory permissions. Our
  implementation restricts access and checks the server's user; a unique pipe name alone would not
  do that. The hosted run checks another user's access denial. These are documented OS facilities,
  not missing Tauri filesystem APIs.

### Does Electron change the conclusion?

Electron's [Node main process][electron-process] could reuse the existing JavaScript file service;
its Chromium renderer also reduces variation between browser engines. That can reduce porting work.
It does not supply mastermind's document conflict policy or make platform testing unnecessary:
[Node documents platform differences in file watching][node-watch]. Electron's
[single-instance API][electron-instance] returns lock ownership and forwards launch data, not
per-file admission results. Our acknowledgment contract still needs application-level handling.

The evidence here does not establish a filesystem-maturity reason to switch to Electron. Tauri
remains selected. Existing Node machinery has no presumption of retention: the native implementation
must preserve the approved experience and file-safety requirements, with simplification welcome.
Package size is
secondary to reliable file handling and portability. The measured diagnostic bundle is not a
production size comparison; no equivalent Electron bundle was built or measured.

### Validation without a local Windows machine

Tauri publishes a [GitHub Actions example][tauri-ci] that runs Rust and WebDriver tests on native
Windows and Linux runners. The experiment's Windows workflow now executes its installed package
and reviewer interaction tests. Continue using native runners for production file and GUI checks; a
cross-compilation result alone would not establish runtime behavior.

CI can establish repeatable behavior on its runner, but does not replace later interactive checks
of installation, focus, Chinese input, and normal desktop use. Some permission checks need an
explicit second-user test setup rather than the default runner identity, as used above. Installed
Linux process validation now passes; its webview interaction remains untested.

Prioritize Windows after macOS; retain a Linux build and smoke-test path at lower priority. This
ordering preserves cross-platform viability without claiming that every platform is already ready.

### Real reviewer on macOS

The optional reviewer build bundles the actual React reading and source views, with no Node sidecar
or HTTP listener. This local build reported 12.23 MiB; it is not a repeated size/performance
comparison. The diagnostic file selector switches among admitted files. Packaged UI checks
through native accessibility automation exercised:

- Two admitted documents in one window, including frontmatter, Chinese headings, CriticMarkup, the
  outline, and a comment card.
- Source editing and Chinese text pasted into the editor; disk inspection confirmed CRLF retention.
  This does not establish Chinese IME composition behavior.
- A clean external edit reloaded through native file notifications.
- A read-only file caused autosave failure. The corrected custom Cmd+Q action and title-bar close
  button kept the window and unsaved text available.
- An external edit while local text remained unsaved opened the existing Base/Local/Disk/Result
  comparison. Saving its reviewed result wrote the intended bytes with CRLF and permissions intact.
- Cmd+Q after the successful save exited the process.
- Deleting a fixture immediately after admission left its original text visible, with saving paused
  and comparison available. The first read consumed the admitted snapshot instead of losing it to
  a later failed disk read.
- The ordinary localhost browser preview still rendered the same document through its HTTP adapter.

The failed-save check caught a macOS lifecycle hazard: the framework's predefined Quit item calls
AppKit termination directly. The initial custom Quit workaround is superseded by the termination
adapter described below.

Rust unit tests cover unchanged invalid UTF-8/BOM/CRLF bytes, stale versions, same-mtime edits,
identical-content replacement, changed descriptors, missing paths, write size limits, multilingual
splices, and Unix inode/permission/symlink preservation. Adapter and store tests cover command/error
mapping, asynchronous listener cleanup, preference-write ordering, slow saves, and retained conflict
results during quit. These checks do not establish every filesystem race or native interaction.

### Reviewer build verification

At source commit `5d4f0c8`, the macOS reviewer package passes the existing 18 process checks and
15 Rust tests. The application suite has 405 passing tests; both TypeScript configurations,
the browser build, and native Clippy checks pass.

[Windows run 38213282288][reviewer-windows-run] builds the React reviewer into the NSIS package,
installs it, passes 17 Rust tests and Clippy, and passes all 13 installed-package process checks.
The separate temporary-account check confirms another ordinary user cannot connect to its pipe.
That runner verifies window presence and native services; it does not exercise editing through
WebView2, Chinese input, or interactive conflict/quit behavior.

### AppKit termination — 2026-10-12

The [termination adapter](../../desktop/src/termination.md) implements AppKit's asynchronous
termination callback
without replacing the framework delegate. The real standard Quit menu now uses this callback.
Packaged macOS checks exercised:

- Standard Cmd+Q after a read-only-file save failure retained the window and unsaved source.
- Restoring write permission changed the file version; the comparison retained the local edits and
  saved the reviewed result. A subsequent standard Cmd+Q exited with those bytes on disk.
- Editing and immediately pressing Cmd+Q flushed the pending edit before process exit, retaining
  CRLF line endings.

The callback cancels a quit during renderer startup, before a close-event subscriber exists.
A native ABI test checks callback dispatch and refusal to override an existing method. The app
suite also checks that a failed exit waits for native cancellation before unlocking the editor.
At `883530f`, this build passed 16 native tests, Clippy, all 18 packaged process checks, 406
application tests, both TypeScript configurations, and both browser and native builds. The adapter
also disarms quit readiness on renderer navigation or termination. The final macOS package passed
failed-save quit, conflict recovery, exact CRLF bytes, and clean quit after the notice fix below.

Dock Quit and normal logout/restart are routed through the same AppKit delegate callback, but these
interactions have not been exercised separately. The automation tool timed out trying to inspect
the Dock; no logout or restart was attempted on the development machine. They remain validation
gaps. Forced termination and crash recovery are outside this save-aware lifecycle.

### Windows reviewer interaction — 2026-10-12

[Run 38216953199][windows-interaction-run] passed at `e0d50c1` on Windows Server 2022. It built and
installed the NSIS reviewer package, passed 18 native tests and Clippy, passed the 13 process
checks, and confirmed that another ordinary user cannot connect to the native pipe.

Tauri WebDriver 2.0.6 with an Edge driver matched to the installed WebView2 Runtime exercised the
actual installed reviewer:

- Admit and render a Markdown file, then switch to its source editor.
- Edit English and Chinese text and verify saved bytes retain CRLF. This is text injection,
  not an IME-composition test.
- Reload an external edit while clean; retain local edits after a read-only-file save failure.
- Open the conflict comparison after an external competing edit, verify all three versions,
  edit the merge result, and save its exact bytes.
- Request native window close after another failed save, verify the unsaved editor remains,
  restore file access, retry autosave, and close successfully.

The run exposed an obsolete error toast covering Compare versions. Disk conflict transitions now
clear transient notices so the persistent recovery control remains usable; three app regressions
cover changed, deleted, and unreadable files. The corrected sequence also passed in packaged macOS.
An earlier harness assertion read animated glyphs instead of the toast's accessible label; it now
reads that label. Failed runs retain screenshot, DOM, driver log, and fixture bytes.

The local app suite has 409 passing tests; both typechecks and browser/native builds pass. macOS
has 17 native tests, including a save-version check that also runs on Windows. These observations
do not establish IME, native dialogs, Windows logoff/shutdown, or everyday focus behavior.

### Graphical opening — 2026-10-12

The packaged macOS reviewer now shares admission between the launcher, native picker, Finder
document events, and window file drops. Desktop automation exercised the Open files button and
Cmd+O, opened a file with no extension, and cancelled the picker without changing the selection.
Finder's Open With menu listed the bundle; opening a Chinese filename from a stopped app retained
the document through startup. Opening another document while running switched the same app to it.
A launcher request containing a missing path followed by two valid paths selected the first valid
file. The bundle's document declaration has alternate handler rank; Launch Services still displayed
it as the default on this machine. The app does not explicitly set the system default handler.

All 18 packaged process checks pass. There are 21 native tests and 415 application tests; both
typechecks, browser/native builds, and native Clippy pass. The five-process translation CLI test
passed alone but repeatedly exceeded its implicit timeout under full-suite concurrency; it now has
an explicit integration-test budget with all assertions retained. This reviewer bundle reports
12.77 MiB, a single observation rather than a performance comparison.

The Windows WebDriver script now checks first-success selection, inventory order, repeated opening,
and retaining unsaved source across a switch away and repeat-open request. Its updated run passed in
the Windows validation recorded below. File-drop gestures, Windows picker multi-selection, and
Windows dialogs have not yet been exercised. Implementation details live in
[native opening](../../desktop/src/opening.md).

### macOS comments and translated review — 2026-10-12

Desktop automation exercised the packaged reviewer by selecting a word within bold text and
composing a comment. Disk assertions checked the exact resulting CriticMarkup and retained CRLF.
This checks selection within formatting, not selection across several formatting boundaries.

In the prepared Chinese view, automation selected the exact passage `带` and composed a translated
comment. The structured payload saved in the source file decoded to language `zh-CN`, the selected
quote, and the entered comment; the file retained CRLF. An external prose change then hid the stale
translation and displayed the update notice. Native Settings changed Translation language to
Chinese and successfully restored Original only. These were packaged UI interactions and disk
assertions; they do not establish Chinese IME composition behavior.

### Windows graphical executable layout — 2026-10-12

The experiment now builds `mastermind-launch-check.exe` with the Windows GUI subsystem and includes
`mastermind-launch-console.exe` as a secondary Cargo binary in the NSIS installer. The console
launcher captures the GUI executable's short-lived command-mode output and returns its status;
file admission, IPC, and host startup remain in the existing implementation. The console process
keeps ordinary terminal waiting behavior, while the installer shortcut targets the GUI executable.

The updated hosted checks inspect both PE subsystems, start the GUI from a parent with no console,
probe the app for an attached console, and then open a file through the console launcher into that
same host. A copied launcher without its GUI sibling must return structured unknown-outcome JSON
and status 3. Existing cold/warm, concurrency, captured-output EOF, and lost-response checks now run
through the companion. The WebDriver harness explicitly decodes Rust JSON as UTF-8, avoiding the
Windows locale decoder's corruption of Chinese paths. The corrected
[installed Windows run](https://github.com/d4wei/mastermind/actions/runs/38356505444) at `45b9612`
passed these checks, other-user endpoint denial, and the full installed reviewer WebDriver sequence.
Console-free graphical startup is observed on that runner; ordinary desktop installation and human
input remain separate checks.

The layout follows the documented Windows subsystem distinction. Runtime console attachment cannot
make a GUI executable block an interactive shell. The newer detached-console manifest policy
requires Windows 11 24H2 or Windows Server 2025, outside the current Server 2022 runner. See
[Microsoft's console policy][console-policy]
and [Tauri's CLI guidance](https://v2.tauri.app/plugin/cli/). The pinned Tauri CLI detects enabled
secondary Cargo binaries; its NSIS bundler installs them beside the primary GUI executable.

### Linux installed package — 2026-10-12

The [Ubuntu run](https://github.com/d4wei/mastermind/actions/runs/38355573893) built and installed
the
reviewer Debian package, passed native tests and Clippy, and passed the Unix process checks against
the installed executable under Xvfb and D-Bus. Package inventory and process observations remain
as workflow artifacts. This establishes installed-process behavior on that runner, not interactive
Linux review or coverage of other distributions.

### Comment controls and editor history — 2026-10-12

The packaged macOS accessibility tree now exposes individual comment actions and the reply input.
The previous outer button role hid those nested controls. Desktop automation submitted a reply;
disk assertions checked the exact CriticMarkup and retained CRLF.

CodeMirror state now survives document and mode switches when the retained source and revision
match. Regression tests exercise real undo, redo, selection, external invalidation, and stale
callbacks. All 421 application tests, both typechecks, and the browser build pass. In the rebuilt
macOS bundle, automation edited file A, switched to file B, reopened A through the launcher, and
pressed Cmd+Z. Disk assertions checked that A returned to its original CRLF bytes and
B stayed unchanged.

The first GUI/console Windows run built successfully but its console probe failed: the helper had
its own windowless console, which caused an access-denied result when attaching to the target. The
probe now detaches explicitly and checks a known windowless-console positive control before checking
the GUI. The corrected installed Windows run passed, including that positive control.

### Parent-directory replacement — 2026-10-12

In the packaged macOS reviewer, a clean open document updated after its parent directory was renamed
away and a new directory and file were created at the original path. A subsequent edit inside the
replacement directory also updated the view, without navigation or focus changes. This checks the
observed macOS watcher behavior. Windows at `d42a17e` passed native undo/redo after switching,
but parent replacement left the clean editor stale throughout its bounded check. Diagnostics
show replacement bytes on disk and the old source still visible, without a conflict notice.

The native adapter now periodically revalidates the active document even after successful watcher
registration; events still invalidate immediately. Fake-timer tests check silent-watch recovery and
cleanup after delayed registration or failure. All 425 application tests and both typechecks pass.
The [corrected Windows run](https://github.com/d4wei/mastermind/actions/runs/38358538986) at
`ed4c156` passed both replacement and later-edit checks, then the existing conflict and close
checks.
Its native suite passed 32 tests and Clippy. The same commit's
[Linux package run](https://github.com/d4wei/mastermind/actions/runs/38358538970) also passed;
Linux parent-replacement interaction remains untested.

Periodic checks now skip while the same document has a native read in flight, allowing slow reads
to settle. Other documents' reads do not suppress the active document's polling, and native events
remain immediate. Deferred-read regressions cover success, rejection, and overlapping reads. All 431
application tests, both typechecks, and the browser build pass. The final polling guard at `d0c74cc`
also passed its
[Windows installed run](https://github.com/d4wei/mastermind/actions/runs/38359268425)
and [Linux package run](https://github.com/d4wei/mastermind/actions/runs/38359268430).

In the rebuilt macOS package, a native picker selected two disposable Markdown files at once. The
first file rendered, and a subsequent launcher request for the second returned `already_open`,
confirming both were admitted by the picker. This does not establish drag-and-drop behavior.

### Blocking filesystem work — 2026-10-12

Native commands and launcher admission now share a bounded worker gate. A worker retains its permit
until completion even when its awaiting command is cancelled or its response deadline expires.
Registry commands also run off the event loop, document writes release the registry before disk I/O,
and preferences writes serialize access to their temporary file. The contract and limitations live
in [native blocking work](../../desktop/src/worker.md).

All 31 local native tests and all-feature, all-target Clippy pass. New tests check cancellation,
timeout after worker startup, panic recovery, serialized writes without the registry lock, and
concurrent preference writes. The rebuilt macOS reviewer passes all 18 packaged process checks.
Windows native and process checks passed before its parent-replacement UI failure. The gate does
not impose a filesystem deadline, bound retained documents, or isolate other requests from a stalled
admission that holds the registry.

### Apple Pinyin composition — 2026-10-13

In the packaged macOS source editor, physical key events entered Apple Pinyin marked text, Space
committed `你好`, and Escape cancelled a subsequent composition. Disk assertions checked the final
UTF-8 text and retained CRLF. The selected-text comment composer exposed a separate defect: Escape
during composition dismissed the composer and discarded its draft.

The comment composers now guard their dismissal and submit shortcuts during composition, including
WebKit's final legacy IME key event. Lifecycle regressions cover cancellation, retained drafts,
modified Enter, ordinary shortcuts afterward, and closing/reopening without blur. All 439
application
tests and both typechecks pass. The [composition sidecar](../../ui/util/composition.md) records
the event contract and sources.

The native retest could not re-establish Pinyin composition: input-source shortcuts yielded plain
Latin text and no candidate commit. That attempt does not validate the fix with Apple Pinyin.
Repeat the comment cancellation and submission checks with confirmed native composition before
closing this gap; injected composition events do not substitute for that check.

### Packaged footprint baseline — 2026-10-13

The release reviewer at `f638221` used 125.39, 149.78, 148.64, 144.47, and 150.39 MiB of aggregate
footprint in five fresh-process runs on the macOS environment above. The median was 148.64 MiB.
Each run opened the same 27,683-byte document in Read mode; its hash, bundle executable hash,
per-process samples, and source line counts are in [footprint-results.json](footprint-results.json).
The bundle contained 13,796,696 logical bytes (13.16 MiB), measured once from the same build.

The measurement used macOS `footprint` with explicit app, WebContent, GPU, and Networking PIDs.
No matching processes existed before or after each run, so the WebKit helpers were attributable to
this app despite their launchd parent. The tool reports a deduplicated footprint across the supplied
processes, including compressed memory; this is not a sum of resident sizes. The first sample had a
longer, unstandardized wait. Later samples waited at least five seconds after the document heading
appeared in accessibility output. Background development tasks remained active.

At the measured commit, the native Rust source contained 2,449 physical lines across 16 files,
including tests, comments, and platform implementations. The TypeScript native adapter contained
227 lines across five files. These counts describe implementation size, not maintenance cost or
an equivalent Electron comparison.

This workload does not bound multi-document memory, undo history, or large files. Cold
open-to-readable timing remains unmeasured: launcher acknowledgment and accessibility-tool round
trips are insufficient substitutes for a controlled rendering measurement.

### Formatted selection and native file errors — 2026-10-13

A packaged macOS check selected the whole paragraph ``Alpha **bravo** charlie `delta` echo.``
in the reading view. The initial implementation hid Comment because it compared raw Markdown with
rendered text. The updated mapping validates complete formatting wrappers against the existing
parser and preserves their exact source. Native automation submitted the comment; disk assertions
checked the full expected CriticMarkup and unchanged formatting and CRLF. Partial cross-wrapper
selections remain refused, as described in
[selection mapping](../../ui/modes/reading/selection.md).

Native file failures now carry stable codes and readable messages. Permission and ordinary I/O
errors retain their classifications, while missing or replaced write targets and stale versions
still enter conflict recovery. Preference reads use the existing write-size limit. The contracts
live in [native file I/O](../../desktop/src/files.md).

All 457 application tests, both typechecks, browser/native builds, 38 all-feature Rust tests, and
native Clippy pass. The rebuilt macOS package passes all 19 process checks, including stable error
codes and messages, and rejection without changing document bytes. At `245bff5`, the
[Windows installed run](https://github.com/d4wei/mastermind/actions/runs/38362526252) and
[Linux package run](https://github.com/d4wei/mastermind/actions/runs/38362526828) both passed,
including the existing Windows reviewer interaction and other-user access-denial checks.

At `73327a2`, selection mapping retains the existing same-text-leaf fallback for entities and
reuses one parsed tree per selection operation. All 460 application tests and both typechecks pass.
The [Windows installed run](https://github.com/d4wei/mastermind/actions/runs/38363755183) and
[Linux package run](https://github.com/d4wei/mastermind/actions/runs/38363754934) also passed.

### Document-readiness instrumentation — 2026-10-13

The opt-in readiness instrument waits for the requested original document,
matching fixture text, visible layout, fonts, and two animation frames. Its local harness measures
from launcher invocation until it observes the matching trace. Deterministic tests cover gate
rejection, article replacement during rendering, one-shot reporting, and cleanup ownership.

No native timing result is recorded yet. The first packaged attempt returned successful admission
but no readiness signal before its deadline. Subsequent native automation reported that the Mac
was locked; the attempt does not establish startup latency or isolate the cause of the missing
signal. Repeat with a visible, unlocked desktop. The metric is a document-layout readiness proxy,
not physical first paint, and its tiny fixture differs from the memory workload above.

### Reopening an edited conflict comparison — 2026-10-13

At `d845cac`, the
[installed Windows run](https://github.com/d4wei/mastermind/actions/runs/38366645519)
retained Base, Local, Disk, and an edited Result after opening another file and repeating the
original file's CLI open. A later external change left the Result intact and disabled saving.
Explicit refresh enabled the reviewed save, whose bytes retained CRLF. The
[Linux package run](https://github.com/d4wei/mastermind/actions/runs/38366645747) also passed its
installed-process checks. It does not exercise this interaction through a Linux webview.

### Native initial setup — 2026-10-13

The validation reviewer now offers Name, Interface language, and optional Translation language
before revealing admitted documents. Separate agent suggestions remain transient; saved choices
and fields already being edited take precedence. Confirmation saves the choices together, and
failure retains a retryable form. The [setup contract](../../desktop/src/setup.md) owns
persistence and protocol
details; the [UI adapter](../../ui/desktop/README.md) owns confirmation and close handling.

All 527 application tests, both typechecks, 57 all-feature Rust tests, and Clippy pass. Browser and
native builds pass. The rebuilt macOS reviewer package passes 25 process
checks, including setup-only startup, transient suggestions, explicit Original only, persisted
completion, and unchanged document bytes. These process checks do not exercise GUI confirmation.
Injected UI tests cover configuration-load ordering, quit during confirmation and reload, failure
recovery, and composition guards.

At `bcc376f`, the
[Windows installed run](https://github.com/d4wei/mastermind/actions/runs/38369645059)
passed transient suggestions, human-edit protection, repeat opening during setup, a failed
confirmation followed by retry, and revealing the admitted file without reopening. Confirmed
choices stayed unchanged after later agent suggestions. The existing source-editing, conflict,
shutdown, and other-user endpoint checks also passed. The
[Linux package run](https://github.com/d4wei/mastermind/actions/runs/38369644778) passed installed
process checks; it does not exercise the setup form through a Linux webview.

The Mac remains locked, so this build has no new interactive macOS onboarding or Apple Pinyin
result. The readiness harness now uses isolated completed preferences; no timing result is added.

### Frontmatter properties — 2026-10-13

At `df344ca`, the shared renderer shows simple metadata as read-only rows with literal YAML
available in a disclosure. Unsupported structures retain literal rendering. Browser inspection
covered multilingual values, multiline strings, narrow layout, and the disclosure; the sample file
remained byte-exact. Selection regressions check that metadata stays excluded while a selection
crossing into body text keeps its exact body range under LF and CRLF.

All 550 application tests, both typechecks, browser and native frontend builds pass. The
[Windows installed run](https://github.com/d4wei/mastermind/actions/runs/38371621982) and
[Linux package run](https://github.com/d4wei/mastermind/actions/runs/38371621978)
passed their existing native process and interaction checks. Those runs do not add a native
graphical frontmatter case;
the new display was inspected through the browser adapter.

### Visible document readiness — 2026-10-13

At `d558466`, five fresh hosts on the unlocked macOS desktop produced valid readiness traces.
The instrumented release build used `readiness-trace`, completed disposable preferences, Read mode,
and the 116-byte public fixture. [The observations](readiness-results.json) retain the executable
and fixture hashes and individual timings: median 0.704 seconds, range 0.666–1.053 seconds.
The harness checked admission identity and unchanged document bytes for each trial.

This measures launcher invocation through observed document layout after two frames, including
trace delivery and polling. It is not physical first paint or a filesystem-cache-cold measurement.
The fixture differs from the earlier memory workload; the combined performance comparison remains
incomplete. The initial sandboxed launcher attempt timed out before admission; the recorded trials
ran outside the shell sandbox.

The instrument was retired on 2026-10-22 because the document selector its trace waited for no
longer exists in the native reviewer.

### macOS onboarding and frontmatter — 2026-10-13

The `d558466` release reviewer was exercised on the unlocked desktop. Actual Apple Pinyin key
input in Name committed `你好` with Space, retained the form after composition Enter, and canceled
new marked text with Escape without losing committed text. The language search accepted `中文`,
kept its picker open through composition Enter and Escape, and selected Simplified Chinese after
composition completed. These IME checks ran in an empty test-app instance.

A separately retained host used an admitted disposable CRLF file and isolated preferences.
Confirmation saved Name `你好`, Chinese interface language, and Original only, then displayed the
already admitted document without reopening it. The name in this persistence check was pasted;
it adds no IME evidence. Preferences were absent before confirmation, and the document stayed
byte-exact. Native inspection also covered metadata rows and the literal YAML disclosure.

### macOS comment-composer Pinyin — 2026-10-13

The retained `d558466` native reviewer accepted actual Apple Pinyin key input in the comment
composer. Space committed `你好`; a subsequent `ni` composition disappeared on Escape while the
composer and committed Chinese draft remained. Enter during a new composition left the composer
open without submitting. Clicking Comment saved the exact expected author-tagged highlight/comment
splice in the disposable source file, with CRLF and all other bytes preserved.

### Adoption consolidation — 2026-10-13

At `1d14dea`, the native host was promoted to the application package (then `src-tauri/`) and built
the reviewer by default. The macOS bundle and window were named `mastermind`; distribution
identifiers remain provisional. Desktop checks live in `tools/desktop/`. The repository launcher
opens the native app. Browser development uses a separate foreground preview, and translation
preparation remains a standalone Node utility.

After relocation, all 483 application tests and both TypeScript configurations passed. The 57
release Rust tests, formatting, and Clippy passed, along with four readiness script checks and two
harness checks. The ordinary macOS bundle built successfully; its packaged executable passed
all process checks, including admission, setup, private endpoints, unknown outcomes, and unchanged
source bytes. The repository wrapper returned a successful admission, displayed the disposable
file at `tauri://localhost/d/0`, retained the settings controls, and quit normally with source bytes
unchanged.

The browser development preview rendered frontmatter, outline, settings, and Markdown mode.
Editing the disposable CRLF source saved exactly the expected bytes; an external edit refreshed
in the editor. Its foreground process stopped on interruption. Markdown corpus fixtures were
unchanged. Windows and Linux workflow paths were migrated; prior platform evidence elsewhere in
this file remains dated and is not a substitute for checking the new revision.

### Adoption platform rerun — 2026-10-13

At `b8ad13b`, [Windows package validation][adoption-windows] and
[Linux package validation][adoption-linux] passed. The first Windows adoption run had retained the
old diagnostic window title in two startup probes. Correcting that expectation allowed the visible
window and console checks to run against the adopted app; no product behavior changed. The Windows
run also passed installed-reviewer WebDriver checks and cross-user endpoint denial. These runs do
not close the interactive and distribution gaps listed below.

### Architecture consolidation — 2026-10-14

At `feb21a2`, the responsibility-based roots, native module split, document records, structured host
boundary, and repeated-analysis cleanup passed the application suite and both TypeScript
configurations: 534 cases in 50 files. The count includes independently named test scenarios and
stronger failure assertions; fixture Markdown bytes were unchanged. All 57 release Rust tests,
formatting, Clippy with warnings denied, four readiness-script cases, and two readiness-harness
cases passed. Browser assets, translation tooling, and the ordinary macOS bundle built successfully.

The packaged macOS launcher passed all disposable process checks. A separate native UI check opened
two files, saved a multilingual edit with CRLF intact, switched away and back, undid the edit using
retained editor history, resolved a discussion, and displayed its retained archive. Disk inspection
confirmed the undo and in-file resolved record with CRLF preserved. The app quit normally after
saving; the check used disposable preferences and documents.

[Windows package validation][cleanup-windows] and [Linux package validation][cleanup-linux] checked
fresh source checkouts at the same revision. Windows exercised its installer, launcher, cross-user
endpoint denial, and installed-reviewer WebDriver cases; Linux installed and exercised its Debian
package. These results cover the refactor and do not close the remaining hardening list below.

### Native theme appearance — 2026-10-17

Build `b434b11` synchronizes native light/dark appearance with the loaded theme. After unlocking
macOS, the reviewer and settings rendered in Carbon. The user confirmed that the inactive traffic
lights were clearly visible against Carbon. The automation capture indicator covered those controls
in screenshots, so that contrast observation comes from the user's direct inspection. Mint and
Slate have not received the same inactive-control check.

### File overflow — 2026-10-18

The overflow change was checked in a disposable macOS release-bundle copy with separate endpoint,
preferences, and application identity. One, three, and twelve files were checked at 1100 px;
thirty files at 1100 and 760 px; fifty at 560 px. Fixtures mixed short names, long Chinese names,
and repeated basenames. Find, Markdown, translation, comments, and More controls were present in
reading mode. The current translation control is still an icon; long language labels need another
native check when the document-level language menu ships.

The active pill remained visible on switching and resize. Selecting the last file by End and Enter
revealed its pill and dismissed the list. Closing a background file kept the list open, retained
the active document, and focused the next close button. The fifty-file list stayed within the
window height and scrolled to the keyboard target. Markdown mode and Command-F remained usable;
Find dismissed the open file list. Unit tests cover the full count/width range calculation and
blocked closes, close-dialog dismissal, localized labels, and focus behavior. These observations
are not a complete native count-by-width matrix or a sustained resource benchmark.

### 2026-10-18 — Document reading languages

A disposable native instance opened a prepared Chinese version through `open --language zh-CN`.
The labeled menu switched to French and Portuguese (Brazil). Markdown view showed the original;
returning to reading restored French, and Find matched a French passage. Reopening with another
language hint did not replace the reader's choice. Switching files retained their separate choices.

An original-only document had no picker. Creating its previously absent translations directory
and a valid artifact made the menu appear without reopening. Selecting and then removing that
artifact returned to Original with a dismissible notification. The process harness passed with
the reduced onboarding fields. Rust and UI tests cover malformed artifacts, independent targets,
freshness, replacement during a draft, submission rereads, and late responses.

The toolbar was exercised with 1, 3, 12, 30, and 50 disposable files, including duplicate basenames
and long Chinese names. Checks included approximately 1100-, 760-, and 560-point widths, with the
long Portuguese label; the active pill, close button, and document controls remained accessible.
The 50-file list exposed paths and disambiguated names; Home/End navigation reached the first and
last documents. Find and the language menu dismissed each other. These are sampled native checks,
not every count-by-width interaction or a sustained resource measurement. Windows interaction with
the new picker has not been run.

### Remaining hardening and distribution checks

Tauri is adopted as the application host. These remaining checks bound release claims; they do not
require keeping a second browser product or continuing the old feature plan.

- Check inactive macOS traffic lights in Mint and Slate; Carbon has been checked above.
- Exercise Dock Quit and remaining desktop termination paths without interrupting the development
  machine's session. Keep failed-save and recoverable-buffer behavior covered.
- Exercise actual drag and drop, broader translated-review refresh and preferences, and interactive
  Windows input, focus, dialogs, and installation. Linux webview interaction remains untested.
- Extend filesystem coverage for unusual filesystems and parent-directory replacement. Existing
  replacement checks cover specific local cases, not every watcher/filesystem combination.
- Bound retained documents before claiming sustained multi-document resource limits. Existing
  measurements use small fixed workloads; they do not establish that bound.
- Settle distribution identity and validate installation, moved bundles, command discovery, and
  signing/notarization before public distribution. Provisional identifiers are not release choices.

[console-policy]: https://learn.microsoft.com/en-us/windows/console/console-allocation-policy

[tauri-fs]: https://v2.tauri.app/plugin/file-system/
[rust-fs]: https://doc.rust-lang.org/std/fs/index.html
[tauri-cli]: https://v2.tauri.app/plugin/cli/
[pipe-security]:
  https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights
[electron-process]: https://www.electronjs.org/docs/latest/tutorial/process-model
[node-watch]: https://nodejs.org/api/fs.html#caveats
[electron-instance]: https://www.electronjs.org/docs/latest/api/app
[tauri-ci]: https://v2.tauri.app/develop/tests/webdriver/ci/

[windows-run]: https://github.com/d4wei/mastermind/actions/runs/38209655085

[reviewer-windows-run]: https://github.com/d4wei/mastermind/actions/runs/38213282288

[windows-interaction-run]: https://github.com/d4wei/mastermind/actions/runs/38216953199

[adoption-windows]: https://github.com/d4wei/mastermind/actions/runs/38520545718
[adoption-linux]: https://github.com/d4wei/mastermind/actions/runs/38520545595

[cleanup-windows]: https://github.com/d4wei/mastermind/actions/runs/38525345222
[cleanup-linux]: https://github.com/d4wei/mastermind/actions/runs/38525345109
