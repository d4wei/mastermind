# Native launch observations — 2026-10-11

The packaged macOS experiment and installed Windows experiment pass their launch checks. This
supports continuing with Tauri and testing the real reviewer next. Windows still needs a normal
graphical entry point without a console; neither run validates production editing and saving.

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
  change detection, conflict checks, and save-aware quit remain application behavior to implement
  and test. Admission now compares Windows volume/file IDs; the Windows unit test distinguishes
  identical-content files. Production write, replacement-race, and watcher tests remain ahead.
- **Console behavior is a documented platform difference.** Tauri's [CLI documentation][tauri-cli]
  warns that production Windows GUI apps cannot write to the invoking console by default and links
  a workaround. Our installed console executable passes captured-output and exit-status tests;
  its spawned GUI child has no console. Direct graphical launch without a console and the final
  executable layout remain to validate. A separate console launcher remains an option.
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
and a window smoke test. Continue using native runners for production file and GUI checks; a
cross-compilation result alone would not establish runtime behavior.

CI can establish repeatable behavior on its runner, but does not replace later interactive checks
of installation, focus, Chinese input, and normal desktop use. Some permission checks need an
explicit second-user test setup rather than the default runner identity, as used above. Linux
execution evidence remains outstanding.

Prioritize Windows after macOS; retain a Linux build and smoke-test path at lower priority. This
ordering preserves cross-platform viability without claiming that every platform is already ready.

### Production host and distribution

This is not the production file host. Validate source-preserving reads and writes, replacement
races, dirty buffers, conflict comparison, failed/slow saves, and save-aware quit with the reviewer.
Bound resource use for retained documents and blocking file reads before exposing the host as a
production entry point. Structured file-error codes and final command/distribution identity also
remain implementation work; this experiment uses diagnostic identities and OS error messages.

App discovery was exercised through the explicit bundle path and the desktop automation tool.
Shell/PATH installation, moved bundles, Finder document-opening events, macOS installation and
notarization, and interactive Windows installation were not tested. No production settings,
language changes, translation views, or onboarding form are implemented by this experiment.

Next, connect a bounded real-reviewer host and validate native reads, writes, external changes,
conflicts, and save-aware quit. Settle the Windows graphical entry point before distribution, and
retain the lower-priority Linux checks. Keep the current app available until the native reviewer
meets the [architecture checks][host-checks].

[host-checks]: ../../docs/architecture-review.md#validate-the-selected-host

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
