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

Windows needs a console/GUI executable test and named-pipe endpoint ownership/ACL implementation;
this experiment explicitly refuses Windows startup. Linux needs native packaging and GUI execution.
There were no native Windows/Linux runners in this run. The library's cross-platform API does not
close these gaps. Keep the separate console-launcher option open until Windows is exercised.

This is not the production file host. Validate source-preserving reads and writes, replacement
races, dirty buffers, conflict comparison, failed/slow saves, and save-aware quit with the reviewer.
Bound resource use for retained documents and blocking file reads before exposing the host as a
production entry point. Structured file-error codes and final command/distribution identity also
remain implementation work; this experiment uses diagnostic identities and OS error messages.

App discovery was exercised through the explicit bundle path and the desktop automation tool.
Shell/PATH installation, moved bundles, Finder document-opening events, normal installation,
notarization, and other-user endpoint isolation were not tested. No production settings, language
changes, translation views, or onboarding form are implemented by this experiment.

Next, close the Windows launcher/endpoint gap on a native runner and port only the validated parts
into a bounded real-reviewer host test. Keep the existing app available until that host meets the
[architecture checks][host-checks].

[host-checks]: ../../docs/architecture-review.md#validate-the-selected-host
