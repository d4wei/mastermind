---
status: living
updated: 2026-11-08
---

# Source map

The interface and the translation utility share a browser-safe document core; the native
application alone gives the interface file access. Each module's contract is the `.md` beside it.
This map names the directories and their entry points, not every sidecar.

- [`document/`](../document/) owns pure Markdown and CriticMarkup semantics and exact source
  splices; the interface and the translation tooling import it. Entry points:
  [scanning and exclusion](../document/markdown/scan.md),
  [the parser pipeline](../document/markdown/processor.md),
  [resolved discussions](../document/review-archive.md), and
  [prepared translations](../document/translation.md).
- [`ui/`](../ui/) owns React reading and Markdown editing, review, Find, preferences, and theme
  application. Entry points: [document state](../ui/documents/store.md) for saves, undo, and
  conflicts; [selection mapping](../ui/modes/reading/selection.md) and
  [the comment rail](../ui/review/comment-rail.md) for review;
  [the desktop adapter](../ui/desktop/README.md) for native opening, setup, and termination.
- [`desktop/`](../desktop/README.md) is the native Tauri host, a Cargo package whose Rust modules
  and their contracts live in `src/`. Entry points: [file writes](../desktop/src/files.md),
  [opening](../desktop/src/opening.md), and [the launcher protocol](../desktop/src/protocol.md).
- [`themes/`](../themes/README.md) holds theme assets, manifest types, and the discovery that
  [`vite.config.ts`](../vite.config.ts) uses to serve and package them, with
  [the bundled fonts](../themes/fonts/README.md) beside them.
- [`tools/`](../tools/) holds the agent-facing
  [translation utility](../tools/translation/prepared-translations.md),
  [desktop packaging checks](../tools/desktop/README.md),
  [performance harnesses](../tools/perf/README.md), and font vendoring.
- [`tests/`](../tests/README.md) explains the boundaries between pure document tests, DOM
  interactions, host adapters, filesystem implementations, and packaged desktop checks.
