# Source map

The interface and translation utility share a browser-safe document core. The native application
alone provides file access to the interface.

- [`ui/`](../ui/) owns React reading and Markdown editing, preferences, and theme application.
  [Document state](../ui/documents/store.md) defines saves, undo, and conflicts.
  [The desktop adapter](../ui/desktop/README.md) connects native opening, setup, and termination.
- [`document/`](../document/) owns pure Markdown and CriticMarkup semantics, exact source splices,
  [resolved discussions](../document/review-archive.md), and
  [prepared translations](../document/translation.md). The interface and translation tooling import it.
  [Markdown scanning](../document/markdown/scan.md) defines source offsets and exclusion rules.
- [`desktop/`](../desktop/README.md) is the native Cargo package. Rust source and contracts live
  in its conventional `src/` directory.
- [`themes/`](../themes/README.md) contains theme assets, manifest types, and the discovery that
  [`vite.config.ts`](../vite.config.ts) uses to serve and package them.
- [`tools/translation/`](../tools/translation/prepared-translations.md) prepares and stores
  translation artifacts for the invoking agent.
- [`tools/desktop/`](../tools/desktop/README.md) builds and checks native packages.

[Regression checks](../tests/README.md) explains the boundaries between pure document tests, DOM
interactions, host adapters, filesystem implementations, and packaged desktop checks.
