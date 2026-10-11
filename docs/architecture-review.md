---
status: living
updated: 2026-10-10
exit: approved changes ship with colocated contracts, or the remaining proposals are dropped
---
# Architecture review and proposed ablation

This is a plan for review, not authorization to refactor. The user requested this checkpoint before
further development. Binding product directions live in [DECISIONS.md](../DECISIONS.md). Findings
below describe the checkout after `005bbd0`; implementation proposals remain unapproved.

## Recommendation

Keep the source-preserving Markdown and CriticMarkup core, the reading surface, and the file tree.
First make document ownership and saving reliable across file switches. Then remove obsolete
serialization and feedback machinery before changing the host. Let the desktop shell own lifecycle,
and retain a small agent-facing way to open chosen files. Avoid moving the whole detached daemon and
its waiting-session protocol into a wrapper unchanged.

The parser is already remark. The mature-library question belongs primarily to rendering, not a
replacement of the entire Markdown stack. The editor already autosaves; removing hand-back means
deleting a second completion protocol and its UI, not introducing saving from scratch.

## What the commands actually do

The command definitions are in [`src/cli/index.ts`](../src/cli/index.ts).

### `new [file]`

Creates a blank file, or an unnamed temporary draft if no path is supplied, then opens it. The
unnamed path brings naming UI, a rename endpoint, session rekeying, and abandoned-draft cleanup.
It is an authoring feature, not necessary to review an existing file. Proposed deletion: the public
command and its exclusively draft-related machinery, unless blank-document authoring earns a place
in the product. Source editing of existing files does not depend on keeping it.

### `workspace .`

Opens a real directory tree. [`Navigator.tsx`](../src/ui/app/Navigator.tsx) and
[`Tree.tsx`](../src/ui/app/Tree.tsx) provide Files/Outline navigation, lazy children, recent
files, and review badges. [`WorkspaceView.tsx`](../src/ui/app/WorkspaceView.tsx) renders one active
file through the ordinary session view. It is not a collection of independently retained document
buffers. Keep the tree and containment checks; replace the command's human-facing role with a
graphical folder/open-files action. A selected review set can coexist with a broader folder tree.

### `translate-blocks <file>`

Emits missing translation blocks as JSON; `--save` accepts translated JSON and writes the cache.
The agent supplies the translation. A block is a source slice derived from a top-level Markdown
node; lists split into individual items. Headings and paragraphs are separate blocks. Code, HTML,
frontmatter, thematic breaks, and definitions are not translated.

[`blocks.ts`](../src/shared/blocks.ts) keys each block by its kind and exact source text. The cache
under `.mastermind/translations/` maps hashes to translated text for a target language, so unchanged
blocks survive surrounding edits. The language pair and a CJK heuristic choose the other language;
this is original text plus cached target blocks, not two fully translated copies of every document.
The translated view is read-only, with source fallback for misses.

Today `open` refuses a cold cache unless `--no-translate` is supplied. There is also a live assist
queue served by an attached agent. Preserve reusable segmentation/cache logic; decide separately
whether both provisioning paths justify their machinery. The earlier proposal that translation
must never gate opening still needs its own ruling.

### `install-agents` / `uninstall-agents`

Copies the bundled main and alias skills into detected harness directories and inserts marked
global instructions where a supported global file is known. Uninstall removes those installed
surfaces. See [`install-agents.ts`](../src/cli/install-agents.ts) and the command implementation.
This is provisioning, not a runtime dependency of Markdown review. Move the human entry point into
onboarding, preserving reversible installation and harness-specific adapters. Assess ordinary
plugin packaging before retaining custom file-copy installation; a GUI button alone does not
simplify the underlying maintenance.

### `status` / `stop`

Inspect or terminate the detached localhost server. That server serves the UI, reads/writes files,
watches external edits, maintains file/workspace sessions, and brokers assist tasks. Hand-back is
only one responsibility. The browser currently needs this filesystem bridge even without hand-back.
The proposed desktop app should own those capabilities and their lifetime; normal users should
not manage a daemon. Keep developer diagnostics only where they still answer a real question.

## File-safety findings to address first

These are source-level findings. The proposed tests below should reproduce each schedule before a
fix is attempted; this review has not run a controlled concurrency reproduction.

1. **A file switch can abandon pending edits.** In
   [`workspaceStore.openFile`](../src/ui/app/workspaceStore.ts), the editor flush updates the buffer
   but does not await a disk save before navigation. [`store.load`](../src/ui/app/store.ts) then
   replaces that buffer and clears the shared autosave timer. Blur/visibility handlers do not cover
   every in-window switch. Test editing A and immediately opening B, with delayed reads and writes.
2. **Async completion has no document identity guard.** The singleton store changes `sessionId`
   before loading, while earlier load/save responses can still update source or saved metadata.
   `load` also retains the review undo history. Test reversed load completion, a save completing
   after navigation, and undo on B after review edits on A.
3. **An edit during a slow save can remain dirty.** A debounce firing while `saving` is true returns
   without writing, and save completion does not schedule the remaining dirty buffer. Test a write
   lasting beyond the debounce while another edit arrives, with no further keystrokes afterward.
4. **The filesystem check is not atomic.** [`files.ts`](../src/server/files.ts) checks mtime and
   subsequently calls `writeFile`; another writer can intervene. Missing files also pass the mtime
   check. [`handback.ts`](../src/server/handback.ts) duplicates this path. Reads obtain text and
   stat separately. Test competing app saves, external replacement/deletion, and same-mtime content
   changes. A shorter debounce does not establish conflict resolution.

Proposed model: each open document owns its base disk version, buffer, undo history, and pending
write. Serialize this app's writes per canonical path, retain edits made during a write, and reject
late responses belonging to another document/version. Keep dirty buffers through navigation and
make close wait for completion or present a recoverable failure. Keep a user-visible save state.

For external changes, propose automatic reload only when the buffer is clean; otherwise retain base,
local, and disk versions for an explicit comparison/merge. Content-based version checks are stronger
than mtime alone. Atomic replacement can avoid partial file contents but does not make a preceding
read/check atomic against unrelated writers. Do not claim lossless concurrent editing without a
cooperative protocol. Symlinks, permissions, and platform replacement behavior need explicit tests.
The precise conflict UX remains a decision before implementation.

## Proposed deletion and consolidation

- **Remove unused Markdown serialization.** Reading uses parse/transform, and Source uses CodeMirror
  over the canonical string. No current caller supplies a Markdown compiler. In
  [`remark-critic.ts`](../src/shared/markdown/remark-critic.ts), remove compiler wrapping and
  serialization registration, then the serializer-only helpers in `critic-mdast.ts`,
  `critic-to-markdown.ts`, and direct dependencies no longer needed. Confirm dependency reachability
  first. Keep masking, the critic AST transform, and source positions; these are used by reading.
- **Remove the feedback-language pass-through.**
  [`feedback.ts`](../src/server/feedback.ts) returns its input unchanged. Collapse its save callers
  and the unreachable rewritten-content response branch; keep a direct regression check that
  multilingual comments reach disk verbatim.
- **Remove legacy history deletion on open.**
  [`sessions.ts`](../src/server/sessions.ts) still deletes old `.mastermind/history/<file>` data
  despite rounds being absent. Opening a review should not double as a recurring legacy cleanup.
  Leave existing historical files alone; do not migrate or delete them in this plan.
- **Delete the explicit hand-back path after safe saving lands.** Remove the button, pulse/toast,
  summary generation, endpoint, and waiting-loop completion event together with their callers.
  Preserve ordinary file watching and review counts. Decide treatment of existing summary blocks
  before removing their reader; do not silently strip document content on open.
- **Untangle assist lifetime from hand-back.** `open --wait` currently also enables translation
  service. Removing its wait loop must not silently remove translation. Either retain an independent
  agent adapter or choose cache preparation as the supported path before deleting queue machinery.
- **Retire draft-only machinery if `new` is dropped.** Trace rename and session rekey callers first;
  keep any operation that still supports an independently chosen file-management capability.
- **Repair the architecture map with the ablation.** `src/README.md` still references missing
  snapshots/rounds and three tsconfigs; there are two. `AGENT_SETUP.md` promises an absent revision
  diff. Update directly coupled claims as each arc lands. Do not sweep unrelated comments.

## Desktop wrapper choice

Both candidates support macOS, Windows, and Linux. Cross-platform capability is a selection
requirement; packaging and native behavior still need testing on each platform.

- **Electron** embeds Chromium and Node. The existing React UI and Node filesystem/watch/cache code
  fit that process model. Proposed shape: privileged document operations in the main process,
  narrow preload IPC to the renderer, and no separate always-running HTTP daemon. This appears to
  require less backend adaptation for this repository; that is an inference, not a measured result.
  See [Electron's introduction](https://www.electronjs.org/docs/latest/) and
  [process model](https://www.electronjs.org/docs/latest/tutorial/process-model).
- **Tauri** uses a Rust core and platform webviews. Reusing the Node backend is possible through a
  packaged sidecar; otherwise its filesystem services need porting. Compare the extra process
  boundary against a Rust implementation before treating the wrapper as thin. See
  [Tauri architecture](https://v2.tauri.app/concept/architecture/) and
  [Node sidecars](https://v2.tauri.app/learn/sidecar-nodejs/).

Recommendation for review: favor Electron if keeping the current backend minimizes total machinery.
Keep Tauri in contention if a small packaged experiment shows a simpler result at acceptable porting
cost. After approval, compare open/save/watch, multiple documents, app reopen, agent invocation,
and shutdown on the supported platforms. Measure package size, startup, and idle memory rather
than selecting on generic framework claims. No wrapper is selected by this document.

## Rendering and frontmatter

[`Renderer.tsx`](../src/ui/modes/reading/Renderer.tsx) renders the remark AST, Critic nodes,
callouts, and source-position attributes needed by selection-to-source mapping.
[react-markdown](https://github.com/remarkjs/react-markdown) supplies a maintained React renderer
with unified/remark/rehype plugins and custom components. It is a candidate for ordinary Markdown
rendering; it does not supply this project's review interaction layer automatically.

Proposed comparison after approval: retain the current renderer as a baseline and render the corpus
through the candidate, checking tables/lists, links, code, frontmatter, callouts, Critic threads,
and selection offsets across inline formatting. Adopt only if the remaining adapters plus dependency
surface are simpler. Keep source splices authoritative; never save serialized rendered output.
CodeMirror already provides the mature source-editing engine. A rich-text editor replacement is a
separate product expansion and is not proposed here.

For frontmatter, [Obsidian Properties](https://obsidian.md/help/properties) is a useful prior: named
rows with values at the top, typed simple properties, and raw YAML/source mode for structures its
property UI cannot represent. Proposal: a quiet, read-only property list for simple keys and values,
with a source fallback for nested/unknown/invalid YAML. Keep bytes, key order, comments, and body
offsets intact. Do not turn display into a YAML rewrite or add a property editor in this arc.
The landed literal frontmatter support is the safe baseline; presentation is still for review.

## Wishlist mapped to product work

- **One graphical onboarding flow:** combine setup, handle/language selection, harness integration,
  and a localized demo. Prefill invocation-provided values, then existing settings/Git defaults as
  appropriate. Precedence, first-run persistence, and which integrations to offer remain open.
- **One review skill:** replace separate setup/demo entry points with the normal launch flow. Blend
  the existing file-review instructions with the squad's `z:markup` convention after ruling on
  agent-authored replies and thread resolution. Keep that protocol portable across harnesses.
- **Smart open:** the session agent has full discretion over the files needing review now. Provide
  a deterministic operation to open its chosen paths; do not encode a Git-only or session-only
  eligibility rule. Git is useful context and is optional. Multi-file UI details remain open.
- **Continuous saving:** use the file-safety work above as the prerequisite to deleting hand-back.
  Optional Git commits remain a separate proposal, with file scope and timing unresolved; autosave
  should not implicitly stage or commit unrelated repository changes.
- **Translation and squad configuration:** preserve the useful bilingual model; decide nonblocking
  opening, live versus prepared translation, and shared versus personal defaults before changing
  these contracts. Graphical onboarding owns the personal language choice.
- **Package identity:** choose the name before distribution changes; package, executable, and config
  migration still need a ruling. A wrapper does not remove collisions with upstream automatically.
- **Claude Code Mods:** retain as an aspiration. Anthropic's
  [official examples][mods] confirm that mods can draw panes and react to the session. This does not
  establish that the existing DOM-based reviewer can be embedded unchanged. A future compatibility
  study must check the terminal/desktop render APIs, selection, input, and accessibility. Keep the
  document core independent of that integration; do not make the wrapper wait for it.

[mods]: https://github.com/anthropics/claude-code-playground/blob/main/claude-code/mods/README.md

## Sequence proposed for approval

1. **Characterize and fix document/save ownership.** Reproduce the schedules listed above; choose
   the conflict UX; land isolated fixes with failing-before/passing-after tests. No new features.
2. **Ablate obsolete machinery.** Remove serialization remnants, pass-through feedback handling,
   and recurring legacy-history deletion in separate coherent commits. Reconcile module maps.
3. **Approve the remaining contracts.** Resolve blank drafts, summary compatibility, translation
   lifetime/open policy, agent replies, and the minimal agent launch interface before deleting their
   existing paths. Record rulings where they constrain future work.
4. **Compare and select the desktop host.** Use the reduced document service for the bounded wrapper
   experiment, then record the choice. Retire detached-daemon and browser-choice machinery only when
   their remaining responsibilities have a tested owner.
5. **Build the chosen review flow.** Implement multi-file navigation, graphical onboarding, skill
   consolidation, and hand-back removal against the settled contracts. Evaluate frontmatter rows
   and the renderer independently so a renderer swap cannot hold the lifecycle work hostage.

Each implementation commit must pass the full test suite and both typechecks. Run the corpus and
byte-preservation cases when touching Markdown, selection, or writes; preserve fixture bytes. Build
before CLI/manual review. Wrapper validation must include external edits, missing paths, window
close/reopen, and actual platform builds, not just a framework's support list.

The checkpoint now is approval or revision of this sequence and its proposed scope. No refactoring,
wrapper implementation, or heavy-track behavior change has been made in this review.
