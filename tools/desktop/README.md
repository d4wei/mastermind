# Desktop build and validation tools

The product host lives in [`desktop`](../../desktop/README.md). This directory contains its
pinned Tauri CLI, frontend builder, disposable process and package checks, and dated measurements.

Install root dependencies with `npm ci` and the CLI with `npm ci --prefix tools/desktop`.
`npm run desktop:build` builds reviewer assets and the macOS app. `npm run desktop:assets` rebuilds
assets alone in `desktop/reviewer-ui`. Use the pinned CLI for other platform packages:

```sh
node tools/desktop/tauri.mjs build --features windows-launcher --bundles nsis -- --locked
node tools/desktop/tauri.mjs build --bundles deb -- --locked
```

Rust and platform Tauri prerequisites are required. Executables retain the provisional identities
documented by the host. The default window is always the reviewer.

Run the Unix process checks against the packaged executable:

```sh
python3 tools/desktop/check.py \
  desktop/target/release/bundle/macos/mastermind.app/Contents/MacOS/mastermind-launch-check
```

The harness uses private disposable runtime directories. `check-windows.py` accepts the installed
Windows console companion. `check-access.ps1 -Binary <installed-GUI-executable>` requires an
administrator on a disposable Windows machine: it creates and removes a temporary account to check
pipe access denial. `check-reviewer-windows.py` drives the installed reviewer using pinned
`tauri-driver` and a matching Edge driver. The [Windows](../../.github/workflows/native-windows.yml)
and [Linux](../../.github/workflows/native-linux.yml) workflows install and exercise their packages.

The [readiness contract](../../desktop/src/readiness.md) describes the opt-in instrumented build
and disposable fixture. Its deterministic checks are:

```sh
node --test tools/desktop/check-readiness-script.cjs
python3 tools/desktop/check-readiness-harness.py
```

`MM_LAUNCH_CHECK_DIR`, `MM_LAUNCH_CHECK_ID`, `MM_LAUNCH_CHECK_DROP_REPLY`, and
`MM_LAUNCH_CHECK_UI_DELAY_MS` are trusted harness controls inherited from launch validation. They
select disposable endpoints, drop an acknowledgment, or delay a window; documents cannot choose
them. [Results](results.md) record dated observations and the remaining hardening and distribution
checks. Build success alone does not establish a production distribution release.
