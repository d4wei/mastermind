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

The bundle and reader window are named `mastermind`. The identifier `dev.mastermind.launchcheck`,
executable `mastermind-launch-check`, and Windows companion `mastermind-launch-console` remain
provisional until distribution identity is settled. Builds here are not signed or notarized
releases.

`main.rs` assembles the native states and command handlers. `launcher.rs` handles command parsing
and local transport startup; `opening.rs` owns the admitted-document snapshot; `document_io.rs`
serves admitted document operations and watches. [Translation discovery](src/translations.md)
offers available reading versions; `lifecycle.rs` creates the window and dispatches menus, close
requests, and application events. Setup uses preference persistence directly.
`appearance.rs` applies the rendered theme's background and native light/dark appearance;
the [theme adapter](../ui/theme/appearance.md) owns its color source and synchronization timing.

The [launcher protocol](src/protocol.md) describes file admission and setup suggestions.
Other native contracts live beside their implementations: [file I/O](src/files.md),
[opening](src/opening.md), [setup](src/setup.md), [preferences](src/preferences.md),
[worker execution](src/worker.md), and
[termination](src/termination.md). The [UI adapter](../ui/desktop/README.md) connects these
commands to the document store.

[Desktop tooling](../tools/desktop/README.md) owns disposable process and package checks.
[Validation results](../tools/desktop/results.md) record dated evidence and the remaining hardening
and distribution checks.
