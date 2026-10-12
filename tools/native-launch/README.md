# Native launch validation

This isolated experiment checks the launcher and app boundary before migrating the editor to Tauri.
It is not the product's desktop host, installer, settings flow, or final application identity.
Its window lists admitted paths; the host retains initial document bytes without editing files.
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

## Boundary under test

One executable has a short-lived command mode and a GUI host mode. The command resolves paths
against its own cwd, rejects non-UTF-8 paths explicitly, and emits one JSON result. Exit codes are
0 for all admitted, 1 for file failures, 2 for malformed invocation/request, and 3 for unknown
outcome. The prototype always reports incomplete onboarding; it implements no preferences UI.

The host owns a filesystem lock for its lifetime. A private, owner-checked runtime directory holds
that lock and a local socket. Concurrent host starts contend for the lock. Only its holder may
remove a stale socket before listening. The protocol uses a bounded newline-terminated JSON frame,
version checking, connection deadlines, and bounded concurrent connection handling. It carries
opening requests and status, not document contents or comments. There is no HTTP/TCP listener.

`interprocess` provides local sockets; Tokio bounds I/O waits. Admission is serialized over the
in-memory document map. A lost acknowledgment may follow successful admission, so retry preserves
already-admitted records. The renderer pulls a snapshot rather than relying on a startup event.
A short refresh interval is diagnostic plumbing, not a proposed production update mechanism.

`MM_LAUNCH_CHECK_DIR` chooses a disposable runtime directory. `MM_LAUNCH_CHECK_DROP_REPLY` drops one
response after processing it. `MM_LAUNCH_CHECK_UI_DELAY_MS` delays native window creation.
These are trusted test-harness controls, not repository-discovered
configuration or proposed product settings. The default runtime directory is also experiment-only.
No shell profile, current app config, or production command installation is changed.

## Limits

This experiment does not validate the complete production file-I/O contract, editing, autosave,
conflict comparison, native close waiting, Finder document events, agent setup, or translations.
Read checks detect some replacements and in-place changes; they are not a filesystem transaction.
A read blocked in the OS can outlive the response deadline. The retained document map has no
session-size limit. Those are reasons not to ship this experiment as a host implementation.

Windows intentionally refuses startup until endpoint ownership and ACL behavior are implemented and
tested on a native runner. Interprocess supports named pipes, but that alone does not establish
user isolation. Linux uses the Unix path but still needs native packaging and GUI tests. The macOS
bundle is a local development artifact, not a signed/notarized distribution release.

See [results](results.md) for observed outcomes and remaining evidence gaps. The forward contract is
[agent launch](../../docs/agent-launch.md). Delete the experiment once its useful checks and
findings have graduated into the production host and tests.
