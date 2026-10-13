# Source map

The React reviewer and translation utility share a browser-safe document core. Native file
services live in [`src-tauri/`](../src-tauri/README.md). Both TypeScript configurations are checked.

- **`ui/`** — React reading and Markdown views over document-owned buffers. `app/store.md` defines
  saves, undo, and conflict ownership. `modes/reading/` renders source-positioned Markdown and
  review marks; `modes/source/` contains the CodeMirror editor. `review/` owns review interactions.
- **`ui/native/`** — the Tauri adapter, native opening controls, onboarding, and save-aware close.
  Its `README.md` describes the frontend boundary; native operations have colocated Rust contracts.
- **`node/`** — standalone translation preparation, theme discovery for builds, and guarded file
  I/O for browser development. These modules do not run inside the desktop app.
- **`shared/`** — Markdown and CriticMarkup parsing, exact source splices, resolved discussion
  records, translation validation and quoted passages, configuration defaults, and types. Keep it
  isomorphic so preparation and both UI hosts use the same document semantics.

The [development preview](../tools/preview/README.md) installs an HTTP implementation of the same
reviewer host interface. It has no background daemon or independent product lifecycle.
[Desktop checks](../tools/desktop/README.md) exercise the native implementation and packaging.

Keep feature contracts beside their implementation: `shared/review-archive.md`,
`shared/translation.md`, `shared/markdown/scan.md`, `ui/app/store.md`, and the native host sidecars.
The root `AGENTS.md` defines the invariants and verification required when changing them.
