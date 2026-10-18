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

## 2026-10-17 — Agents prepare languages; readers choose prepared versions

**Ruled.** Remove the app's Translation language preference from Settings and onboarding. The
preparing session agent chooses whether and which translations to prepare; explicit user requests
override that discretion and may name multiple languages. The app offers available prepared
versions per document, retaining freshness validation, source mapping, and feedback in the original
Markdown. Interface language remains independent. Missing translations never gate opening.

This supersedes the personal translation preference and its earlier Settings picker rulings.

**Beat:** asking readers to configure translation preparation in the app, or replacing mapped
translations with independent Markdown copies that lose source-linked review feedback.

## 2026-10-17 — Square sizing applies only to single-icon buttons

**Ruled.** Narrow the icon-button rule below to simple, single-icon actions. Settings' segmented
selectors retain their wide rectangular choices. Find's Aa symbol functions as a single icon and
keeps its square control.

**Beat:** applying square button geometry to every control that depicts its choice with a glyph.

## 2026-10-17 — Icon-only buttons have square interaction surfaces

**Ruled.** Icon-only buttons share square hit and hover areas at standard or compact sizes. Text
button padding must not distort them; glyph shape does not determine the control's proportions.

**Beat:** independently padded icon controls with inconsistent rectangular hover surfaces.

## 2026-10-17 — Find uses a compact floating panel

**Ruled.** Place Find below the top-right controls without shifting document layout. Typical search
queries are short, so the field and navigation controls should occupy only the space they need.
Keep the current result visible outside the panel's footprint when navigating matches.

**Beat:** a full-width Find row that reserves document space for mostly unused input width.

## 2026-10-17 — Theme accents identify discussions and primary actions

**Ruled.** Comments and primary actions use the selected theme's accent family. Navigation,
selection, focus, and ordinary document content remain neutral; insertion, deletion, and highlight
retain distinct semantic roles. The theme layer owns shared derived tokens and print colors;
palette CSS also supplies picker swatches and native light/dark appearance.

**Beat:** independent comment palettes, duplicated CTA aliases and manifest colors, and native
appearance disconnected from the selected theme.

## 2026-10-17 — Comment activation opens a reply

**Ruled.** Comment cards always show their quoted passage. Activating a commented passage or card
opens the discussion and focuses its reply composer; hover and text selection do not. Paused editing
keeps discussions readable without starting new replies. Comment entrances fade without vertical
travel, independently of the document's horizontal layout transition.

**Beat:** selecting a discussion solely to reveal its quote or an additional Reply action.

## 2026-10-17 — Balance reading space and normalize document controls

**Ruled.** Preserve document centering when comments fit beside it; otherwise center the reading
and comment group after reserving the visible outline strip. Use a panel when the selected font
size leaves insufficient reading width. Document controls share neutral surfaces and optical icon
weight; selection changes their surface rather than making the comment icon heavier.

**Beat:** flexible empty space beyond fixed-width cards, uniformly shifting the document whenever
comments appear, and emphasizing one toolbar action through several visual changes at once.

## 2026-10-17 — Resolve conflicts by preserving or choosing a version

**Ruled.** Remove in-app three-way merge. Autosave accepted edits and reload external changes when
no local edits remain. A verified conflict offers Save As and Use incoming; I/O failures offer
Retry and Save As. Keep version-checked writes, retained local text, and the exceptional close
choices. This supersedes the earlier immediate-clean-merge ruling. Persisted work buffers remain
a separate direction.

**Beat:** maintaining a merge operation and its recovery states for concurrent editing that can
instead be preserved as separate files and reconciled deliberately outside the reviewer.

## 2026-10-17 — Autosave handles routine exit; recovery stays direct

**Ruled.** Flush accepted edits on close or quit and leave silently when saving succeeds. Show a
save decision only after failure or a conflict blocks saving. Recovery surfaces expose useful
actions directly with at most two decision controls; no Review options gate or stacked custom
recovery boxes. Only failed/blocked-save close dialogs retain Save As, Don't Save, and Cancel.
An unfinished draft stays in its existing composer; Cancel returns focus there instead of showing
a second input. This refines the preceding editor-conventional close ruling for autosave.

**Beat:** ordinary Save All prompts in an autosaving editor, hidden recovery choices, and duplicated
draft editors that disconnect a close decision from the work being interrupted.


## 2026-10-17 — Follow familiar editor save and close conventions

**Ruled.** Closing saved work is silent. When closing would lose unsaved work, offer the familiar
save, don't-save, and cancel decision, with the affected files and drafts named. That dialog is the
confirmation; do not add a second confirmation or hide discard behind recovery controls. Preserve
version-checked writes and offer Save As when saving the original is unsafe. Familiar editor
behavior takes precedence over a custom recovery workflow; session restoration remains deferred.

**Beat:** trapping the user behind unresolved conflicts, or inventing a two-stage discard-and-exit
flow with its own terminology.


## 2026-10-17 — Animate the home wordmark as two intact rows

**Ruled.** Drift the two rows independently and send them beyond opposite window edges when opening
leaves home. Fade the entire outgoing and incoming screens. Keep the Open button stationary within
each screen and respect reduced motion. This supersedes the earlier action-hover lift.

**Beat:** independent character motion, which distorted the wordmark, and moving the Open button
between home and toolbar alongside the wordmark departure.

## 2026-10-17 — Keep the empty home focused on opening Markdown

**Ruled.** Show the two-row block-letter wordmark with its horizontal slit and one outlined
Open Markdown files… action. Give the wordmark a subtle lift on action hover or keyboard focus,
respecting reduced motion. Keep the native ellipsis convention and an explicit Markdown label.

**Beat:** repeating the opening instruction above the button, or adding continuous decoration.

## 2026-10-15 — Keep compact discussions anchored to their passages

**Ruled.** Use compact cards with readable opening comments and collapsed replies. Selecting a
passage or card expands its discussion near the passage, arranging neighbors without overlap in
source order. Hover only emphasizes the connection. Preserve unfinished replies when collapsing
or switching discussions; selection is transient interaction, not a discussion status.

**Beat:** shrinking neighboring comments, which reduces readability in sparse documents, and a
fixed stack with connectors, which can separate a discussion too far from its passage.

## 2026-10-15 — Suggest changes through replacement text

**Ruled.** The selection action is Suggest change. Editing the selected text proposes a replacement;
clearing it proposes deletion. Preserve separate editable fragments rather than spanning intervening
marks or block boundaries with one suggestion.

**Beat:** a deletion-only action that makes one edit kind the whole feature.

## 2026-10-15 — Give each discussion one visible document target

**Ruled.** An anchored discussion uses its underlined passage, with fill for active and hover
states. Only an unanchored discussion needs a separate marker. Replies do not add markers of their own.

**Beat:** simultaneously highlighting, underlining, and appending a diamond to the same passage.

## 2026-10-15 — Resolve file conflicts through explicit recovery actions

**Ruled.** Pause editing only for the affected file and retain its local text. Offer Use incoming,
Try merge, and Save my version as… in a dismissible bottom-left notification, with persistent file
attention status. Try merge saves a clean three-way text merge immediately against the incoming
version; overlapping changes write nothing. Saving a copy must never overwrite an existing file.

**Beat:** a page-wide banner and manual comparison editor, or a separate approval step after a clean
merge that the person explicitly requested.

## 2026-10-15 — Corner treatments follow component roles across themes

**Ruled.** Use one corner scale across palettes: small for inline and inset elements, medium for
controls, and large for cards and panels. Keep position ticks square and native window geometry
system-owned. The design system assigns roles; theme tokens own the values.

**Beat:** independently rounded buttons, inputs, cards, and panels without a shared hierarchy.

## 2026-10-15 — Keep document scrolling separate from application controls

**Ruled.** Scroll the document and its wide comment rail inside a bounded viewport. Keep application
controls and overlay panels outside that surface. Review actions start from selected text; remove
the section hover menu because it duplicates selection actions and makes pointer movement fragile.

**Beat:** page-level scrolling that carries controls during overscroll, and whole-block hover actions.

## 2026-10-15 — Integrate macOS window controls into the file toolbar

**Ruled.** Remove the separate macOS title strip and retain native traffic lights in the file
toolbar. Keep the full active path as window metadata and a pill tooltip. File pills have close
buttons; closing releases an open file after save checks and never deletes its disk contents.

**Beat:** stacked native and application headers, and file pills that only accumulate.

## 2026-10-14 — Clarify personal settings and translation selection

**Ruled.** Label the comment-author preference Your name / 你的名字 in Settings. Keep the onboarding
question What should we call you? / 怎么称呼你？. Use one searchable Translation language picker,
with Original only inside its choices, in both Settings and onboarding.

**Beat:** the ambiguous Name label and separate, duplicated Original only controls.

## 2026-10-14 — Keep reader controls at the window edges

**Ruled.** Use a square Open files action and horizontal file pills at the top left, with the active
file's full path in the native title. Keep the Read/Markdown toggle standalone. Place Settings and
Resolved in a top-right overflow menu. Use a compact heading outline with an active-section
indicator and a list revealed by hover, click, or keyboard focus. In both views, square-ended bars
use uniform thickness. Inactive bars shorten with heading depth; the active section has the longest
bar. Popup bars share a left edge while heading labels retain their indentation.

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
