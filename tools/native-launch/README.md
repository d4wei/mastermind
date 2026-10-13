# Native launch validation

This isolated experiment checks native launch and the reviewer before migrating the app to Tauri.
It is not the product's desktop host, installer, settings flow, or final application identity.
Its default window lists admitted paths. The optional reviewer build edits through native commands.
The existing web app and CLI are unchanged.

## Run

From this directory, install with `npm ci`, then `npm run build`. Rust and the platform's native
Tauri build prerequisites are required. Dependency versions are exact and both lockfiles belong
with the experiment. `cargo test --release --locked` exercises file admission independently of the
GUI. The icon comes from the repository's `site/public/favicon.svg` via the pinned Tauri icon tool.

On macOS, the generated bundle is `target/release/bundle/macos/mastermind launch check.app`.
Its executable is `Contents/MacOS/mastermind-launch-check`. Run the packaged executable as:

```sh
"/path/to/mastermind launch check.app/Contents/MacOS/mastermind-launch-check" open -- file.md
```

`python3 check.py "/path/to/the/packaged/executable"` runs the disposable process checks. It creates
private runtime directories and document fixtures under `/tmp`, and terminates only the hosts it
started. It tests unresponsive peers and lost responses; allow the bounded request deadline to run.
The check script requires Unix sockets and is not a Windows test runner.

On Windows, build with
`npx tauri build --features windows-launcher --bundles nsis -- --locked`. The installed GUI is
`mastermind-launch-check.exe`; the console command is
`mastermind-launch-console.exe open -- FILE...`.
Run `python check-windows.py <installed-console-launcher>` after installing the NSIS package.
The [Windows workflow](../../.github/workflows/native-launch.yml) builds, installs, and exercises
that package on a hosted runner. It uploads the installer and process-check output.
`check-access.ps1 -Binary <installed-executable>` additionally requires an administrator on a
disposable Windows machine: it creates a temporary local account, checks pipe access denial, and
removes the account and test files. Pass the installed GUI executable to its `-Binary` parameter.

The [Linux workflow](../../.github/workflows/native-linux.yml) builds a reviewer `.deb`, installs it
on Ubuntu 24.04, and runs the existing Unix process checks against `/usr/bin/mastermind-launch-check`
under Xvfb and D-Bus. It retains package metadata and logs. This checks the installed native service;
it does not exercise review interactions through the Linux webview.

## Real reviewer build

With root dependencies installed, run `npm run build:reviewer --prefix tools/native-launch` from
the repository root. It bundles the React reader, source editor, themes, and fonts in the same
macOS app. The launcher invocation is unchanged. On Windows, generate assets with
`node --import tsx tools/native-launch/build-reviewer.mts`, then build from this directory:

```powershell
npx tauri build --config tauri.reviewer.conf.json --features reviewer,windows-launcher `
  --bundles nsis -- --locked
```

The Windows workflow builds this variant and runs its native unit, process, and WebDriver checks.
`check-reviewer-windows.py` drives the installed reviewer using `tauri-driver` 2.0.6 and an Edge
driver matching the installed WebView2 Runtime. It checks editing, autosave, external changes,
conflicts, and window close. Driver and fixture files belong to the disposable test run.

The reviewer has a diagnostic file selector, native guarded reads/writes, file invalidations,
prepared-translation reads, and isolated experimental preferences. It starts no Node process or
HTTP service. The shared document store still owns source edits, autosave, undo, and conflicts.
Native dialogs, file drops, and macOS document events use the same
[opening operation](src/opening.md) as the launcher.
Contracts live in [native file I/O](src/files.md) and the
[UI adapter](../../src/ui/native/README.md).

Window close and Quit await the document store's save check. The macOS
[termination adapter](src/termination.md) connects AppKit termination to that check, including the
standard Quit menu. Observed behavior and untested termination paths remain recorded in the results;
this build must not be treated as a production-safe replacement for the browser app.

The opt-in [document-layout readiness measurement](src/readiness.md) builds a separate instrumented
reviewer variant and measures five fresh launches with a disposable public fixture.

## Boundary under test

macOS and Linux use one executable with a short-lived command mode and a GUI host mode. Windows
packages that executable with the GUI subsystem and adds a console launcher. The companion resolves
the GUI executable beside itself, forwards native arguments and cwd, captures its command-mode
output, and returns its exit status. It owns no endpoint or file-admission implementation and exits
after the command-mode process. Wrapper failures emit the shared unknown-outcome JSON response and
diagnostics on stderr. The GUI command resolves paths against its cwd, rejects non-UTF-8
paths explicitly, and emits one JSON result. Exit codes are
0 for all admitted, 1 for file failures, 2 for malformed invocation/request, and 3 for unknown
outcome. The prototype always reports incomplete onboarding; it implements no preferences UI.

On Unix, the host owns a filesystem lock for its lifetime. A private, owner-checked runtime
directory holds that lock and a local socket. Only its holder may remove a stale socket.
On Windows, a user-scoped named pipe reserves its first instance exclusively. Its access descriptor
allows the current user; clients check the server process's user before sending paths. Interprocess
rejects remote clients and Windows reclaims the pipe when its last handle closes. The protocol uses
a bounded newline-terminated JSON frame,
version checking, connection deadlines, and bounded concurrent connection handling. It carries
opening requests and status, not document contents or comments. There is no HTTP/TCP listener.

`interprocess` provides local sockets; Tokio bounds I/O waits. Admission is serialized over the
in-memory document map. A lost acknowledgment may follow successful admission, so retry preserves
already-admitted records. The renderer pulls a snapshot rather than relying on a startup event.
A short refresh interval is diagnostic plumbing, not a proposed production update mechanism.

`MM_LAUNCH_CHECK_DIR` chooses a disposable Unix runtime directory. `MM_LAUNCH_CHECK_ID` chooses a
Windows test namespace within the current user's pipe name. `MM_LAUNCH_CHECK_DROP_REPLY` drops one
response after processing it. `MM_LAUNCH_CHECK_UI_DELAY_MS` delays native window creation.
These are trusted test-harness controls, not repository-discovered
configuration or proposed product settings. The default runtime directory is also experiment-only.
No shell profile, current app config, or production command installation is changed.

## Limits

The reviewer build exercises native editing and conflicts, but does not complete the production
validation matrix. Onboarding, full termination coverage, and
interactive platform checks remain. See the results for what has actually been exercised.
Read checks detect some replacements and in-place changes; they are not a filesystem transaction.
A read blocked in the OS can outlive the response deadline. The retained document map has no
session-size limit. Those are reasons not to ship this experiment as a host implementation.

The Windows launcher is a feature-gated Cargo binary, included beside the GUI app by the pinned
Tauri NSIS bundler. The installer shortcut targets the GUI app. CLI output passes through pipes, so
it does not require attaching the GUI command process to a console. The persistent host disables
handle inheritance: redirecting its own standard streams alone would leave inherited launcher
pipes open and prevent a capturing agent from receiving EOF. `CREATE_NO_WINDOW` is retained in the
host spawn; Windows ignores it for GUI-subsystem executables. The installed Windows checks inspect
both PE subsystems and start the GUI from a parent with no console; an attachment probe checks
the running app. This layout awaits hosted Windows validation. The second-account test checks
access denial, but endpoint checks do not establish
isolation from administrators or malicious same-user processes. Windows reads compare open-handle
volume/file IDs. See the results for native file and WebView2 reviewer coverage and remaining
interactive checks.
Linux retains the Unix implementation but needs native packaging and GUI tests. macOS bundles are
local development artifacts, not signed/notarized distribution releases.

See [results](results.md) for observed outcomes and remaining evidence gaps. The forward contract is
[agent launch](../../docs/agent-launch.md). Delete the experiment once its useful checks and
findings have graduated into the production host and tests.
