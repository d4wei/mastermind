# Native desktop host

Tauri hosts the mastermind reviewer from `ui/desktop.html`. The app starts no Node process or
HTTP service. Rust owns native file admission, guarded reads and writes, invalidations, preference
confirmation, and window termination.

After installing the platform's Tauri prerequisites and Rust, build from the repository root:

```sh
npm ci
npm ci --prefix tools/desktop
npm run desktop:build
cargo test --manifest-path desktop/Cargo.toml --release --locked --all-features
```

`desktop:build` creates the macOS app. For Windows, build assets with `npm run desktop:assets`, then
run `node tools/desktop/tauri.mjs build --features windows-launcher --bundles nsis -- --locked`.
For Linux use the same command without the feature flag and with `--bundles deb`.
Exact native dependencies are in `Cargo.toml` and `Cargo.lock`; the pinned CLI is in
`tools/desktop`.

`npm run dev` runs `tauri dev` through the pinned CLI. It serves `ui/desktop.html` with Vite on
port 5173, then builds and opens the debug host. Interface edits apply through hot module
replacement; Rust edits rebuild and relaunch the host. Open files with the Open button, or from a
second shell with `node bin/mastermind.js open -- FILE`, which hands them to the running host.
Ctrl-C stops both.

The development host claims the same per-user endpoint as the installed app. Quit mastermind before
`npm run dev`; otherwise the development host exits at once and stops the session with it. A debug
binary always loads its interface, with full command access, from whatever answers on the
development server's port. When `bin/mastermind.js` finds only a debug build, it therefore hands
files only to a host `npm run dev` already started and never starts one; without a running host it
exits with `host_not_running`. `npm run desktop:build` produces the standalone app.

The bundle and reader window are named `mastermind`. The identifier `dev.mastermind.launchcheck`,
executable `mastermind-launch-check`, and Windows companion `mastermind-launch-console` remain
provisional until distribution identity is settled. Builds here are not signed or notarized
releases.

`main.rs` assembles the native states and command handlers. `launcher.rs` handles command parsing
and local transport startup; `admission.rs` owns the admitted-document registry; `opening.rs`
handles graphical opening and inventory snapshots; `closing.rs` relays launcher close requests to
the renderer; `document_io.rs` serves admitted document operations and watches. [Translation
discovery](src/translations.md) offers available reading versions; `lifecycle.rs` creates the
window, keeps its navigation within the app's own origin, and dispatches close requests and
application events; [`menu.rs`](src/menu.md) builds the localized application menu and routes its
items. Setup uses preference persistence directly. `appearance.rs` applies the rendered
theme's background and native light/dark appearance; the [theme adapter](../ui/theme/appearance.md)
owns its color source and synchronization timing.

The [launcher protocol](src/protocol.md) describes file admission and setup suggestions.
Other native contracts live beside their implementations: [file I/O](src/files.md),
[opening](src/opening.md), [menu](src/menu.md), [setup](src/setup.md),
[preferences](src/preferences.md),
[worker execution](src/worker.md), and
[termination](src/termination.md). The [UI adapter](../ui/desktop/README.md) connects these
commands to the document store.

[Desktop tooling](../tools/desktop/README.md) owns disposable process and package checks.
[Validation results](../tools/desktop/results.md) record dated evidence and the remaining hardening
and distribution checks.
