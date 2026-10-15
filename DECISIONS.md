# Decisions

These rulings govern this repository. In older entries, "squad" means the initial group of three
reviewers, and "upstream" means [Jingquank/Mastermind](https://github.com/Jingquank/Mastermind).
The [README](README.md) describes the current application;
[native validation](tools/desktop/results.md) records platform evidence and remaining gaps.

- Add an entry only when deleting it would change a future choice.
- Keep execution history in commits, figures in their measured artifacts, and inventories in their
  manifests.
- Cite external evidence with a sha, path, or section; do not reproduce its narrative here.
- Keep accepted entries immutable. Add the newest ruling directly below the divider; correct an old
  ruling with a new entry instead of rewriting it.
- Keep each ruling to its decision, rationale, and rejected alternative; do not add day-digests.

Use this entry shape:

```
## YYYY-MM-DD — <the ruling, stated as settled fact>

**<Ruled | Measured | Ratified>** (<optional external pointer>). <why, in a clause.>

**Beat:** <what this ruling beat.>
```

- Use **Ruled** for a deliberate choice, **Measured** for a result that closes future investigation,
  and **Ratified** for an adopted external requirement.
- Omit the pointer when the entry's own commit contains all necessary provenance.

* * *

## 2026-10-14 — Keep reader controls at the window edges

**Ruled.** Use a square Open files action and horizontal file pills at the top left, with the active
file's full path in the native title. Keep the Read/Markdown toggle standalone. Place Settings and
Resolved in a top-right overflow menu. Use a compact heading outline with an active-section
indicator and a list revealed by hover, click, or keyboard focus.

**Beat:** a file dropdown, the centered control capsule, and a persistently expanded outline.

## 2026-10-14 — Use the block-letter M on Grid orange-red as the app icon

**Ruled.** Preserve the original two-row capital M, its horizontal gap, and light-shade texture in
the application icon. Use Grid's orange-red background. Keep the editable SVG beside native exports
in `desktop/icons/`.

**Beat:** lowercase variants that evoked a fast-food brand and simplified marks that lost the
character art's texture.

## 2026-10-13 — Source roots follow application responsibilities

**Ruled.** Use `ui/` for the interface, `document/` for isomorphic document semantics, and
`desktop/` for the native Cargo package, retaining its conventional inner `src/`. Place development
utilities beside their consumers. Audit test failure modes before refactoring and retain regression
coverage until equivalent replacements work. Maintain theme CSS directly; retire the one-off
palette generator.

**Beat:** runtime-named source roots, parallel editable palette definitions, and reducing test counts
without checking which failures they detect.

## 2026-10-13 — Adopt Tauri and consolidate before further product work

**Ruled.** The validated Tauri host becomes the application. Promote its implementation and retire
superseded browser-runtime, daemon, workspace, blank-draft, and app-owned installation machinery.
Preserve browser development as explicit development tooling. Track remaining native checks as
bounded hardening and distribution work; they do not keep the host in experiment status.
Consolidate code and documentation, then revisit the product plan before adding features.
Distribution identity remains deferred.

**Beat:** extending the native experiment and original feature backlog while retaining two product
runtimes indefinitely.

## 2026-10-11 — Preserve the review experience while reassessing native machinery

**Ruled.** Continue with Tauri. Porting the Node implementation is an opportunity to simplify;
existing machinery has no presumption of retention. Preserve the approved review experience and
file-safety requirements, and evaluate each native implementation against those requirements.

**Beat:** selecting or retaining infrastructure chiefly to avoid rewriting existing Node code.

## 2026-10-11 — Portability takes priority over distributable size

**Ruled.** Current use is macOS-only; Windows support remains important and Linux is lower priority.
Preserve a credible cross-platform filesystem and packaging path. A smaller distributable does not
justify inadequate file support; revisit the wrapper choice if required behavior lacks a viable
implementation. This refines platform priority without changing the selected Tauri direction.

**Beat:** treating macOS success or package size as sufficient evidence for the desktop choice.

## 2026-10-11 — File admission succeeds independently of initial setup

**Ruled.** The launcher acknowledges admitted files and reports incomplete setup without waiting
for it. The GUI presents one initial setup screen before the normal reviewer, retaining files
admitted during setup. Confirm Name; provide a usable Interface language default and optional
Translation language. Agent suggestions use a separate setup operation and cannot overwrite saved
or actively edited fields. Subsequent preference changes use ordinary settings behavior; existing
comments retain attribution and quoted-language context.

**Beat:** rejecting file admission until setup completes or maintaining a partly enabled reader.

## 2026-10-11 — Opening files and assisting onboarding are separate operations

**Ruled.** Opening adds explicit files, returns each path's result, and preserves existing buffers
and conflict state. Individual file failures do not prevent valid files from opening. Opening does
not carry name or language-setting flags; agents may separately suggest onboarding values for the
person to confirm in the GUI. Whether incomplete onboarding blocks opening remains under review.

**Beat:** using file opening to change identity or language settings as a side effect.

## 2026-10-11 — Desktop migration has no legacy compatibility obligation

**Ruled.** Existing commands and stored formats may be removed or replaced during desktop migration.
Do not retain adapters, aliases, or migration machinery solely for backward compatibility; preserve
the selected product capabilities and file-safety invariants instead. Validate native launch and
packaging in a bounded proof of concept before migrating the editor host.

**Beat:** preserving old command contracts before validating native launch.

## 2026-10-10 — Product vocabulary follows one canonical reference

**Ruled.** [Product terminology](docs/terminology.md) defines the accepted English and Simplified
Chinese names for labels, onboarding, documentation, and implementation. Apply its naming rules
without changing feature semantics; config and serialized-format migrations require coordinated
changes. This supersedes earlier terminology in this ledger, while preserving those rulings'
meaning.

**Beat:** carrying session vocabulary into the product or reopening accepted names in each feature.

## 2026-10-10 — The application name is styled as lowercase mastermind

**Ruled.** Use `mastermind` in product copy, documentation, and application titles. Retain
`Mastermind` when referring to Kevin Ding's original project. This is a display-name convention;
package, executable, and configuration-directory identity remain a separate decision.

**Beat:** sharing the original project's capitalized display name.

## 2026-10-10 — Tauri hosts the desktop app with native file services

**Ruled.** Use Tauri with a narrow Rust host and retain the React/TypeScript document core. The
maintainer accepts the Rust learning and maintenance cost. Preserve browser development and validate
native file safety, shutdown, Chinese input, and cross-platform packaging against the reviewed plan.
The production app does not retain the HTTP server, detached daemon, or a Node sidecar.

**Beat:** choosing Electron for Node reuse or requiring a two-framework prototype before proceeding.

## 2026-10-10 — Translation is freshly prepared without a live service

**Ruled.** The document's preparing agent supplies a complete fresh translation on each preparation
pass. Do not automatically reuse translations across passes. A local prepared snapshot supports
reading and reopening; prose or proposed-edit changes invalidate it, while comments, highlights,
and resolved history alone do not. Discussion stays in its authored language. Open the original
without waiting for translation, and remove the live queue, separate translator, and hand-back loop.

**Beat:** per-block reuse without context validation, Git HEAD as a freshness key, and dependency
tracking before there is evidence that its complexity is needed.

## 2026-10-10 — Translated review comments anchor to the original block

**Ruled.** A reader may comment from the comfort-language view. Store the comment in the original
Markdown file against the corresponding source block, retaining the precise selected translated
passage as quoted context and identifying its language. Keep exact text edits on the original;
best-effort translated review does not require character-level alignment or a second feedback store.

**Beat:** requiring a reader to switch languages for every comment, or treating translated offsets
as positions in the source.

## 2026-10-10 — The fork does not carry legacy review compatibility

**Ruled.** Existing hand-back summaries and translation caches impose no compatibility requirement;
there is no squad data to migrate. Retire summary-specific behavior with hand-back and choose future
translation storage for the new workflow. This does not authorize rewriting arbitrary input files.

**Beat:** retaining readers, migration paths, or old cache formats for an unused workflow.

## 2026-10-10 — Agents may answer in author-tagged file threads

**Ruled.** Agents may append author-tagged replies to active discussions in the Markdown file.
Ship a self-contained public convention with neutral examples; private skill material is not a
runtime dependency or an automatically publishable source. Confirm ambiguous material before
porting.

**Beat:** upstream's human-only mark rule and copying a private workflow wholesale into the public
package.

## 2026-10-10 — Conflict application uses the reviewed versions

**Ruled.** Keep Base, Local, Disk, and an editable Result in a persistent comparison. Applying a
result requires the reviewed disk version and captured local revision; a later change requires
explicit refresh. Keep local text and edited results across panel close and file switches. Missing
files remain recoverable in memory without implicit recreation; adopting disk remains undoable.

**Beat:** blind overwrite or silently refreshing the write precondition behind the comparison.

## 2026-10-10 — Resolved discussions remain in a hidden in-file archive

**Ruled.** Delete removes an individual comment; Resolve archives a completed thread, including its
quoted context and authors, in a marked HTML comment at the file tail. Both actions support undo.
The app exposes resolved discussion separately; agents treat it as history and may clean it up.
Resolution does not implicitly accept or reject an attached edit. The approved architecture plan
sets the sequence; record encoding and compatibility checks belong to that work.

**Beat:** conflating resolution with deletion or keeping discussion only outside the Markdown file.

## 2026-10-10 — Repo language is a repository setting

**Ruled.** The language used for repository communication and bookkeeping is scoped to the repo;
comfort language remains personal. Repo language establishes a concrete need for repo settings,
without making every preference repo-configurable. Storage, discovery, and precedence remain open.

**Beat:** storing repo language only as a global user preference shared by unrelated repositories.

## 2026-10-10 — Clean external changes reload; dirty buffers retain both versions

**Ruled.** Reload external changes automatically only when the buffer is clean. When it is dirty,
retain base, local, and disk versions for explicit comparison and merge. The detailed interaction
remains open; saving more frequently is not conflict resolution.

**Beat:** treating a shorter autosave delay or unconditional overwrite as conflict handling.

## 2026-10-10 — The app owns an ephemeral review session

**Ruled.** The desktop wrapper owns file services and runtime state, replacing the detached daemon
and its status/stop workflow. Review-session state ends on app quit; document edits remain on disk.
Session restoration, including a possible SQLite store, is deferred. Existing preferences and
translation caches are separate from review-session restoration.

**Beat:** carrying the detached daemon and its independent lifetime into the desktop product.

## 2026-10-10 — Harness installation belongs outside the app

**Ruled.** Retire app-owned harness detection, skill copying, and global-instruction injection.
Describe installation in skill/package guidance for the invoking harness to carry out; a dedicated
installation skill is optional if ordinary guidance is insufficient.

**Beat:** moving a custom harness installer behind a graphical onboarding button.

## 2026-10-10 — Language roles are repo language and optional comfort language

**Ruled.** Support complete single-language operation. When translation is wanted, distinguish the
repo's communication/bookkeeping language from the user's comfort language; the invoking agent
supplies translations. Configuration scope and translation interaction details remain open.

**Beat:** requiring two symmetric preferred/secondary languages for every user.

## 2026-10-10 — Native file access replaces the separate workspace experience

**Ruled.** Use the desktop host's OS-native facilities to open and browse files. Retire the separate
workspace experience instead of transplanting its custom tree into the wrapper. File-access
validation and containment for any retained root-scoped operations remain required.

**Beat:** preserving the underdeveloped workspace UI as the basis of desktop navigation.

## 2026-10-10 — Blank-draft creation is outside the review product

**Ruled.** Remove `new` and its exclusively draft-related machinery; reviewing and source-editing
existing documents do not require a blank-file creation workflow.

**Beat:** retaining draft naming, temporary files, and abandoned-draft cleanup for this use case.

## 2026-10-10 — The session agent chooses which files need review

**Ruled.** The default skill request deliberately leaves file selection to the invoking agent's
judgment. Git changes and conversation context are inputs, not an exhaustive selection rule.

**Beat:** defining eligibility as either all uncommitted Markdown or only session-touched files.

## 2026-10-10 — Desktop selection must preserve cross-platform viability

**Ruled.** Initial use is on macOS, but the wrapper must have a credible Windows and Linux path
without replacing the product architecture. Packaging and verification remain explicit work.

**Beat:** choosing a macOS-only direction because it serves the first user's machine.

## 2026-10-10 — Review saves continuously without explicit hand-back

**Ruled.** The review workflow uses automatic saving and removes the explicit hand-back action,
so reviewing several files does not require a separate completion ritual for each one. Agent and
assist suggestions still require acceptance before the app writes them. Conflict behavior and
optional Git commits remain open.

**Beat:** a per-file hand-back button and waiting CLI process as the review's completion contract.

## 2026-10-10 — A desktop wrapper owns the review window

**Ruled.** The product will use a desktop wrapper and remove the browser-choice setting. The choice
between Tauri and Electron remains open.

**Beat:** retaining the browser container or making browser app mode the fork's destination.

## 2026-10-10 — Graphical onboarding covers the initial setup

**Ruled.** One graphical onboarding flow covers the handle, languages, setup, and demonstration;
invocation may prefill identity and language choices. People are not expected to operate the CLI.
An agent-facing invocation interface remains compatible with this direction.

**Beat:** separate setup and demo skill invocations as the expected human onboarding path.

## 2026-10-10 — Architecture review precedes further development

**Ruled.** Present the architecture findings and proposed deletion/refactor plan for the user's
review before implementing it or building more features. Product directions do not approve an
implementation plan by themselves.

**Beat:** proceeding directly from the wishlist into refactoring or feature construction.
