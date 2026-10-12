# Native launch observations — 2026-10-11

The packaged macOS experiment passes its admission and process checks. This supports continuing
with the one-executable launcher candidate on macOS. It does not select the production transport
across platforms or authorize replacing the current host before the remaining checks.

## Environment and reproduction

Apple M1 Pro, arm64, macOS 26.6.2 (25G83), Rust/Cargo 1.98.0. Tauri 2.12.3, tauri-build 2.7.2,
Tauri CLI 2.12.2, and Interprocess 2.4.5 are pinned in the manifests and lockfiles here. The macOS
release bundle reported 10.91 MiB. It contains the diagnostic page, not the React reviewer.

Run the [README commands](README.md#run) against the packaged executable, not the unbundled Cargo
binary. [check-results.json](check-results.json) records one passing process run. Its cold and warm
timings measure subprocess start through admission acknowledgment; they are not first-paint or
review-ready times. They are single samples during concurrent build/testing activity, not a
performance benchmark. Dependencies were downloaded during setup; the running host uses local IPC.

## Observed

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

## Remaining evidence and implementation gaps

### Windows support: implementation gaps, not a failed framework test

The Windows refusal comes from our own `runtime_dir()` guard in
[src/transport.rs](src/transport.rs). The experiment implements Unix directory permissions and
socket cleanup only. It has not run on Windows, so this is neither an observed Windows failure nor
evidence that Tauri lacks Windows filesystem support. The launcher transport is our use of
Interprocess; it is separate from Tauri's webview-to-Rust bridge.

There are three different questions:

- **Ordinary file access is supported.** Tauri's [filesystem documentation][tauri-fs] covers
  Windows, macOS, and Linux, and directs Rust host code to `std::fs` or `tokio::fs`. Rust's
  [filesystem API][rust-fs] exposes cross-platform operations. Our source-preserving saves, external
  change detection, conflict checks, and save-aware quit remain application behavior to implement
  and test. The experiment's replacement checks also contain Unix-only branches; passing on macOS
  does not establish equivalent Windows file safety.
- **Console behavior is a documented platform difference.** Tauri's [CLI documentation][tauri-cli]
  warns that production Windows GUI apps cannot write to the invoking console by default and links
  a workaround. That is known; whether one packaged executable meets our captured-output and exit
  status contract is untested. A small console launcher remains an option, not a framework change.
- **Endpoint permissions need a Windows implementation.** Windows named pipes have
  [access-control rules][pipe-security] that differ from Unix socket-directory permissions. Our
  implementation must restrict access and establish endpoint ownership; a unique pipe name alone
  does not do that. These are documented OS facilities, not missing Tauri filesystem APIs.

### Does Electron change the conclusion?

Electron's [Node main process][electron-process] could reuse the existing JavaScript file service;
its Chromium renderer also reduces variation between browser engines. That can reduce porting work.
It does not supply mastermind's document conflict policy or make platform testing unnecessary:
[Node documents platform differences in file watching][node-watch]. Electron's
[single-instance API][electron-instance] returns lock ownership and forwards launch data, not
per-file admission results. Our acknowledgment contract still needs application-level handling.

The evidence here does not establish a filesystem-maturity reason to switch to Electron. Continue
with Tauri while testing Windows early, and revisit the choice if those checks expose an unsupported
required behavior or a disproportionate amount of platform-specific machinery. Package size is
secondary to reliable file handling and portability. The measured diagnostic bundle is not a
production size comparison; no equivalent Electron bundle was built or measured.

### Validation without a local Windows machine

Tauri publishes a [GitHub Actions example][tauri-ci] that runs Rust and WebDriver tests on native
Windows and Linux runners. Use hosted Windows CI for build, packaged command invocation, process
races, endpoint permissions, and filesystem behavior, then automate the window smoke test. Do not
stop at cross-compilation: executing the Windows binary is the relevant evidence.

CI can establish repeatable behavior on its runner, but does not replace later interactive checks
of installation, focus, Chinese input, and normal desktop use. Some permission checks need an
explicit second-user test setup rather than the default runner identity. No Windows or Linux
execution results have been collected yet.

Prioritize Windows after macOS; retain a Linux build and smoke-test path at lower priority. This
ordering preserves cross-platform viability without claiming that every platform is already ready.

### Production host and distribution

This is not the production file host. Validate source-preserving reads and writes, replacement
races, dirty buffers, conflict comparison, failed/slow saves, and save-aware quit with the reviewer.
Bound resource use for retained documents and blocking file reads before exposing the host as a
production entry point. Structured file-error codes and final command/distribution identity also
remain implementation work; this experiment uses diagnostic identities and OS error messages.

App discovery was exercised through the explicit bundle path and the desktop automation tool.
Shell/PATH installation, moved bundles, Finder document-opening events, normal installation,
notarization, and other-user endpoint isolation were not tested. No production settings, language
changes, translation views, or onboarding form are implemented by this experiment.

Next, implement the missing Windows launcher and endpoint handling in the isolated experiment,
then execute the admission and file-safety checks on a hosted Windows runner. Keep the current app
available until the real-reviewer host meets the [architecture checks][host-checks].

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
