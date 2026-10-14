---
status: living
updated: 2026-10-13
exit: approved simplifications land and their contracts move beside the implementation
---

# Architecture simplification

Review the architecture before further feature work. The previous cleanup removed the browser
product runtime; it did not establish that the remaining implementation is minimal.

This proposal covers repository layout, source responsibilities, development tools, and the order
of a subsequent test audit. It preserves the current review experience and file protocol. The
structural changes below await review. Removing the inherited marketing site was explicitly
approved and is handled separately.

## Findings from the current implementation

The baseline is adoption commit `1d14dea`. The TypeScript import scan followed static imports,
re-exports, and literal dynamic imports from both UI entry points, translation preparation,
preview startup, and the desktop asset builder. Every TypeScript module under `src/` was reachable.
That rules out an obvious pile of unused modules; it does not establish that every export, branch,
or abstraction is needed. The findings below combine that scan with inspection of the main data
flows and their implementation. A line-by-line test audit remains a later step.

### Theme generator and inherited site

`scripts/gen-scales.mjs` creates twelve-step gray and accent color palettes in OKLCH, maps them to
semantic CSS tokens, and adds the configured review colors. It overwrites seven
`themes/<id>/tokens.css` files and prints color round-trip and contrast readings. It does not create
theme manifests, font presets, layout, or visual effects. Its printed thresholds do not fail the
command when a contrast reading falls short.

There are no build or documentation callers. Running a copy in a disposable directory reproduced
all seven checked-in token files byte-for-byte. Its opening claim that it is not committed is
incorrect. This is a working one-off generator, not a demonstrated source of current token drift.

**Recommendation:** delete it and maintain the CSS tokens directly, as the theme contract already
specifies. Remove obsolete generation notes when touching those token files; preserve their values.
If editable palette generation becomes a real requirement, give it one documented source of truth
and a checkable output contract then. Merely renaming it would preserve two editable palette copies.

`site/` is an independent Astro package describing the original author's release. No application
or build caller was found outside that package. Remove its source, assets, package files, and
lockfile. Keep the original project's attribution and MIT notice in the application repository.

### Source layout describes technology inconsistently

`src-tauri/` identifies a tool, `src/node/` identifies a runtime, and `src/shared/` identifies its
consumers. None names a single product responsibility. Rust's inner `src/` has a different role:
it is the conventional source directory inside one Cargo package.

**Recommendation:** use three clear source roots and keep Cargo's internal convention:

```text
ui/                         React interface and application state
  desktop/                  desktop opening, setup, close, and command adapter
  documents/                open-document state, saves, conflicts, and selection
  ...                       reading, Markdown editor, settings, theme application

document/                   pure Markdown and CriticMarkup operations
  critic/
  markdown/
  translation/
  ...                       source edits, line endings, resolved discussions

desktop/                    native application package
  Cargo.toml
  Cargo.lock
  tauri.conf.json
  src/                      Rust source and colocated contracts
  icons/

themes/                     theme manifests, tokens, fonts, and discovery tooling
tools/
  desktop/                  build entry points and packaged application checks
  preview/                  foreground browser development host and its file I/O
  translation/              agent translation preparation and artifact file I/O

tests/                      test organization audited after the architecture review
assets/agent/               public agent workflow and review convention
```

Move document semantics out of `shared/`; move UI preferences, font registries, and code-color
registries to their UI owners. Do not move everything currently called shared into `document/`:
font choice and presentation settings are not document semantics. Put theme manifest types beside
theme discovery so the builder and interface can consume the same format. Keep pure shared types
free of Node, React, and Tauri imports.

Move the four Node modules to their actual consumers: guarded file access into the preview,
translation preparation into its tool, and theme discovery beside the themes. Translation artifact
reading currently serves the preview too; preserve one Node implementation instead of copying it.
The document core remains importable by both the interface and translation preparation.

Tauri's pinned CLI supports selecting its package through `TAURI_APP_PATH`; the build wrapper can
set that to `desktop/` explicitly. Preserve the framework's configuration filenames. Update the
launcher, build inputs, ignored output paths, CI caches and artifact paths in the same relocation.
Keep provisional package and executable identities unchanged: naming a source directory does not
settle distribution identity.

References: [pinned Tauri CLI path resolution][tauri-paths] and
[Cargo package layout][cargo-layout].

### Document state and interface composition carry too many responsibilities

`ui/app/store.ts` currently combines the document registry, active-document projection, editor
callbacks, debounce timers, write serialization, external-read generations, undo, conflict
comparison, and shutdown preparation. Several maps track different parts of one document's state;
a subscription copies the active Zustand record back into the registry.

`SessionView.tsx` combines analysis, translation lifetime, source loading, event subscriptions,
keyboard handling, panel exclusivity, navigation data, and reading composition. The same file
coordinates ordinary and translated selection. These are active behaviors, not deletion evidence.

**Recommendation:** make one document record own its source, saved base, write state, pending
invalidations, and conflict draft. Keep the open-document registry and active ID separate from the
React-facing view state. Move the save/conflict lifecycle behind that record's operations before
splitting presentation components. Retain existing race and recovery tests during the change.
Do not merely distribute the current mutually dependent maps among more files.

Give mutually exclusive transient panels one owner instead of coordinating several booleans in
callbacks and effects. Keep persistent conflict drafts independent of whether their panel is open.
Keep translated comment drafts tied to their captured source and translated passage; hiding a
panel or receiving a newer artifact must not silently change what a pending comment refers to.

### Host interface still carries browser-server conventions

`app/api.ts` mostly forwards calls to `ReviewerHost`. Both adapters import its HTTP-shaped
`ApiError`, and native document failures use status numbers to satisfy the store. `DocumentEvents`
looks like an EventSource even though the native adapter constructs those messages itself.
The config store imports the document store solely to display a settings-save failure.

**Recommendation:** let document operations use a small host contract with structured failures and
an invalidation subscription. Translate HTTP statuses and SSE payloads inside the preview adapter;
translate native command failures inside the desktop adapter. Remove the forwarding layer once
its error type has a proper owner. Settings-save feedback belongs to settings or an app-level
notice owner, not an arbitrary active document.

Retain the host boundary: it earns its place by allowing the same reviewer to run in a native
webview and a browser. Avoid adding another service hierarchy beneath it.

### Markdown work repeats across one source revision

`analyzeMarkdown` invokes the CriticMarkup-aware parser, whose plugin calls `scanMarkdown`, then
calls `scanMarkdown` again for spans. Each scan parses the source. Resolved-thread counting and
translation preparation also parse independently. The parser and renderer are already based on
remark, unified, and GFM; this is not an entirely custom Markdown engine.

**Recommendation:** produce a document analysis for one exact source revision and reuse its tree,
spans, review items, and derived outline where their semantics agree. Start by eliminating the
second identical scan inside the reading analysis. Preserve the distinction between the original
Markdown tree and the masked tree used to render CriticMarkup. Do not introduce a global cache or
share results across different source strings. Preserve exclusion ranges and exact source offsets.

Keep remark and CodeMirror for this pass. The handwritten code highlighter and selection-to-source
mapping deserve separate review: first determine which behavior is required and compare existing
library support before retaining or replacing that machinery. A renderer replacement is not a
prerequisite for cleaning up repeated analysis.

### Native ownership is spread across broad modules

`reviewer.rs` contains document command handlers, watcher ownership, translation artifact reads,
preference file I/O, application menus, and close commands. `setup.rs` calls preference helpers
owned by `reviewer.rs`, while the reviewer delegates preference operations back to setup. `main.rs`
contains launch parsing, transport startup, snapshot commands, runtime assembly, and lifecycle
callbacks. The names no longer communicate these boundaries well.

**Recommendation:** give preference persistence one module used by setup and settings commands;
keep document I/O and watching together behind admitted-document operations; put menus and close
handling with application lifecycle. Keep `main.rs` as assembly plus dispatch to those owners.
Keep a single Rust package; this does not require a Cargo workspace or several library crates.

Preserve the local launcher transport, OS-specific endpoint checks, bounded blocking work, exact
file versions, and save-aware quit. Each addresses a current requirement. Node and Rust guarded
file writes serve different hosts; similar intent does not make either safe to delete without a
replacement that still supports browser development.

`NativeReviewer` polls opening and setup snapshots every half second, including after setup is
complete. Consider an initial snapshot plus invalidation events and focus revalidation. Review
subscription races before removing polling. This is separate from active-file revalidation, whose
backstop exists for observed watcher failure modes; do not remove that backstop as incidental
cleanup.

## Implementation order after review

1. Preserve the verified baseline: Windows and Linux package validation passed at `b8ad13b`,
   following correction of the startup probes to match the adopted application title.
2. Audit the tests against the accepted architecture before changing the state model. Identify
   distinct safety coverage and candidates for consolidation. Retain regression checks until their
   replacement is working; do not combine a behavior refactor with deleting its existing coverage.
3. Remove the one-off palette generator if this recommendation is accepted. The inherited site
   removal can land independently because it is already approved.
4. Relocate source and tools without changing behavior. Keep contracts beside their modules and
   update every build, launch, test, and CI path. Verify a clean-checkout build and packaged launch.
5. Simplify the host boundary and native ownership. Retain adapter contract checks, file safety,
   opening, setup, and termination checks throughout.
6. Consolidate document lifecycle and repeated analysis in separate changes. Preserve byte-exact
   fixtures, selection mappings, concurrent-save behavior, and translated comment lifetime.
7. Complete test consolidation against the resulting implementation. Delete obsolete checks only
   when the audited failure mode is retired or covered by the retained replacement.

Each implementation step gets its own reviewable commit and relevant checks. Run the full
application suite and both TypeScript checks before every commit. Native changes also require Rust
unit tests, formatting, lint, and the affected packaged platform checks. Test fixtures remain
byte-exact. No new features or distribution decisions are included in this proposal.

## Test audit after the architecture review

The current suite has 51 TypeScript test files and 483 executed cases; Rust has colocated unit
tests, and desktop tooling adds process and platform checks. Counts alone do not establish bloat.
The comprehensive audit should cover all of these layers, including fixtures and manual checks.

For every test, identify the public behavior or failure mode, the owning layer, and whether its
assertions would detect a plausible regression. Then assign keep, merge, rewrite, or delete with a
specific reason. Trace retained safety requirements to actual tests without creating a second
permanent inventory to maintain.

Prioritize overlapping autosave/document-store setup, fragmented selection/composition fixtures,
mocked fetch responses in host-neutral state tests, CSS/source-text assertions, and duplication
between native unit tests and process harnesses. Shared fixtures should remove repeated setup;
they should not hide the scenario or become a configurable testing framework.

Keep separate coverage when it detects different failures: a pure source splice test, a DOM
selection test, and a native input check are not interchangeable. Retain malformed markup,
line-ending preservation, stale-write rejection, failed-save recovery, IME composition, and
cross-platform file behavior unless an equivalent check is demonstrably taking over.

## Review requested

- Adopt `ui/`, `document/`, and `desktop/` as the source roots, retaining Cargo's `desktop/src/`.
- Retire the palette generator and keep maintained theme CSS as the authority.
- Approve the simplification sequence above, with the test audit after architecture review and
  regression coverage retained while each implementation changes.

[tauri-paths]:
https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.2/crates/tauri-cli/src/helpers/app_paths.rs
[cargo-layout]: https://doc.rust-lang.org/cargo/guide/project-layout.html
