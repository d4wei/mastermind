# Native launch observations

The packaged macOS experiment and installed Windows experiment pass their launch checks. This
supports continuing with Tauri. Packaged macOS checks and installed Windows WebDriver checks now
exercise native editing, autosave, external changes, conflict recovery, and save-aware close.
The Windows GUI/console executable layout passes installed-package validation. Interactive Windows
input checks remain outstanding.

## Environment and reproduction

Apple M1 Pro, arm64, macOS 26.6.2 (25G83), Rust/Cargo 1.98.0. Tauri 2.12.3, tauri-build 2.7.2,
Tauri CLI 2.12.2, and Interprocess 2.4.5 are pinned in the manifests and lockfiles here. The macOS
release bundle reported 10.91 MiB. It contains the diagnostic page, not the React reviewer.

Run the [README commands](README.md#run) against the packaged executable, not the unbundled Cargo
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
The experiment still has no editor, save operation, onboarding form, or production preferences.

## Remaining evidence and implementation gaps

### Windows support: implementation gaps, not a failed framework test

The initial Windows refusal came from our experiment's own guard, not a failed Tauri test.
The current [Windows endpoint](src/endpoint/windows.rs) implements named-pipe ownership and access
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
explicit second-user test setup rather than the default runner identity, as used above. Linux
execution evidence remains outstanding.

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

The [termination adapter](src/termination.md) implements AppKit's asynchronous termination callback
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
[native opening](src/opening.md).

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
`ed4c156` passed both replacement and later-edit checks, then all existing conflict and close checks.
Its native suite passed 32 tests and Clippy. The same commit's
[Linux package run](https://github.com/d4wei/mastermind/actions/runs/38358538970) also passed;
Linux parent-replacement interaction remains untested.

Periodic checks now skip while the same document has a native read in flight, allowing slow reads
to settle. Other documents' reads do not suppress the active document's polling, and native events
remain immediate. Deferred-read regressions cover success, rejection, and overlapping reads. All 431
application tests, both typechecks, and the browser build pass. The final polling guard at `d0c74cc`
also passed its [Windows installed run](https://github.com/d4wei/mastermind/actions/runs/38359268425)
and [Linux package run](https://github.com/d4wei/mastermind/actions/runs/38359268430).

In the rebuilt macOS package, a native picker selected two disposable Markdown files at once. The
first file rendered, and a subsequent launcher request for the second returned `already_open`,
confirming both were admitted by the picker. This does not establish drag-and-drop behavior.

### Blocking filesystem work — 2026-10-12

Native commands and launcher admission now share a bounded worker gate. A worker retains its permit
until completion even when its awaiting command is cancelled or its response deadline expires.
Registry commands also run off the event loop, document writes release the registry before disk I/O,
and preferences writes serialize access to their temporary file. The contract and limitations live
in [native blocking work](src/worker.md).

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
modified Enter, ordinary shortcuts afterward, and closing/reopening without blur. All 439 application
tests and both typechecks pass. The [composition sidecar](../../src/ui/util/composition.md) records
the event contract and sources.

The native retest could not re-establish Pinyin composition: input-source shortcuts yielded plain
Latin text and no candidate commit. That attempt does not validate the fix with Apple Pinyin.
Repeat the comment cancellation and submission checks with confirmed native composition before
closing this gap; injected composition events do not substitute for that check.

### Production host and distribution

This remains a validation host. Complete normal termination paths, broader translated-review checks,
Chinese IME composition, remaining graphical entry paths, and interactive Windows input checks
before replacing the current app. Bound retained documents and settle
structured file errors and command/distribution identity. Watcher coverage for parent-directory
replacement and unusual filesystems remains open.

App discovery was exercised through the explicit bundle path and desktop automation. Shell/PATH
installation, moved bundles, macOS installation/notarization, interactive
Windows installation, and onboarding were not tested. Broader preference controls and translation
refresh interactions still need verification beyond the packaged macOS checks above. Linux webview
interaction
remains outstanding. Keep the current app available until the native reviewer meets the
[architecture checks][host-checks].

[host-checks]: ../../docs/architecture-review.md#validate-the-selected-host
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
