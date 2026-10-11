---
status: living
updated: 2026-10-10
exit: approved changes ship with colocated contracts, or the remaining proposals are dropped
---
# Architecture review and proposed ablation

The user approved execution of this plan and the hidden-content recommendation on 2026-10-10.
Binding constraints live in [DECISIONS.md](../DECISIONS.md). Execution starts with document/save
ownership and obsolete-code removal; choices explicitly left open below remain open. The original
source findings describe the checkout after `005bbd0`; completion notes identify work landed since.

## Recommendation

Keep the source-preserving Markdown and CriticMarkup core and the reading surface. Use native file
access in the desktop host instead of preserving the separate workspace experience. First make
document ownership and saving reliable across file switches. Then remove obsolete
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
It is an authoring feature, not necessary to review an existing file. Remove the public command and
its exclusively draft-related machinery. Source editing of existing files remains supported.

### `workspace .`

Opens a real directory tree. [`Navigator.tsx`](../src/ui/app/Navigator.tsx) and
[`Tree.tsx`](../src/ui/app/Tree.tsx) provide Files/Outline navigation, lazy children, recent
files, and review badges. [`WorkspaceView.tsx`](../src/ui/app/WorkspaceView.tsx) renders one active
file through the ordinary session view. The first execution batch added retained document buffers
beneath this view. The trial found the workspace experience disconnected and underdeveloped. Retire
that experience and use the desktop host's native facilities to open and browse files. Do not
rebuild or transplant the custom workspace tree by default. Keep path validation at file-access
boundaries; any retained root-scoped operation must still enforce its root.

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

The new language model has a repository-scoped language for communication and bookkeeping, plus an
optional personal comfort language. Single-language operation requires no second language or
translation preparation. The invoking agent supplies translations when needed. Replace
preferred/secondary language semantics and the script-based direction guess with these explicit
roles. Repo settings have a place in the design, with repo language as the first concrete use case.
Storage, repo discovery, defaults outside a repo, precedence, mixed-language documents, and review
interactions need detailed design; this does not require making every preference repo-configurable.

Today `open` refuses a cold cache unless `--no-translate` is supplied. There is also a live assist
queue served by an attached agent. Preserve reusable segmentation/cache logic; decide separately
whether both provisioning paths justify their machinery. The earlier proposal that translation
must never gate opening still needs its own ruling.

### Translation without a live service

The user proposes preparation and refresh by the same agent that prepares the document, using its
existing context. There is no need to preserve upstream translation caches. The app would read
prepared artifacts; no translator agent, request queue, or waiting session is necessary. This is a
long-term proposal, not a compatibility mode. Translation still requires generation time in the
preparing agent's turn; opening the original need not wait for it.

The remaining contract should cover:

- **Freshness:** associate translated output with the source revision and target language. Current
  block hashes detect changed block bytes, but unchanged wording can change meaning when surrounding
  context changes. Require the preparing agent to reassess translation after document revisions;
  do not treat an unchanged block hash as evidence of semantic freshness.
- **Missing preparation:** show the current original with a clear unavailable/stale indication until
  the preparing agent supplies current output. Do not display stale translations as current or make
  the app create a request that needs another agent to wait on it.
- **Feedback anchoring:** read-only translated prose was a proposal about mapping feedback back to
  source, not retaining old data. A minimal useful review surface could accept comments against the
  corresponding original block, in the reviewer's language. Exact selected-text edits still need
  the original; a translated character offset cannot identify an original character offset.
- **Storage and languages:** choose a simple derived artifact and explicit source/target metadata.
  Repo language, personal comfort language, file discovery, and freshness validation must agree;
  there is no requirement to preserve the old cache format or language-pair heuristic.

Feedback in a comfort language remains in the original Markdown file. Translation artifacts contain
no exclusive review state. Whether block-anchored commenting is sufficient needs the user's ruling
before implementation.

### `install-agents` / `uninstall-agents`

Today these commands copy bundled skills into detected harness directories and insert marked global
instructions; uninstall removes those surfaces. See
[`install-agents.ts`](../src/cli/install-agents.ts) and the command implementation.

Remove harness-directory detection, skill copying, and global-instruction injection from the app.
Installation guidance belongs with the skill/package README so the invoking harness can install it
through its own facilities. An installation skill is optional if the README is insufficient;
there is no replacement app installer in this plan. Existing installations need a documented removal
path when retiring the commands, not a background cleanup that edits harness files on app launch.

### `status` / `stop`

Today these commands inspect or terminate the detached localhost server. It serves the UI, performs
file I/O and watching, maintains sessions, and brokers assist tasks. Removing hand-back alone does
not eliminate those responsibilities; the desktop host takes them over.

The target is an editor-style app whose wrapper owns its runtime and review-session state. Remove
the detached daemon and its status/stop workflow once those responsibilities run under the app's
lifetime. Review-session state is in memory and ends when the app quits; saved Markdown remains on
disk. Existing preferences and translation-cache files are separate from session restoration, and
this ruling does not require deleting them. SQLite is a possible later choice for restoring app
state, not a dependency or a second store for review feedback in this iteration.

## File-safety findings to address first

The original source findings below now have controlled regressions and fixes for navigation, stale
responses, slow saves, and competing writes. Document ownership lives in
[`store.md`](../src/ui/app/store.md); filesystem guarantees and limits live in
[`files.md`](../src/server/files.md). The explicit comparison panel now uses those same ownership
and version checks.

The implemented regression cases live in `tests/document-store.test.ts` and
`tests/file-safety.test.ts`. Keep these cases when changing the host. Browser unload currently
requests a prompt while retained buffers are dirty or saving; native close must wait for completion
or present a recoverable failure. Keep a user-visible save state.

Clean-buffer reload and explicit comparison for dirty buffers are implemented. The comparison
contract lives with the store; the source snapshots, edited result, and guarded apply actions are
covered by `tests/document-store.test.ts` and `tests/conflict-panel.test.tsx`. Native close must
still wait for completion or offer recovery; the browser cannot supply that lifecycle guarantee.

## Proposed deletion and consolidation

Completed in the first execution batch: serializer removal, feedback pass-through removal, and
legacy history-pruning removal. A deterministic regression identified pruning as the cause of the
intermittent translation-cache failure. The remaining deletions below retain their prerequisites.

- **Delete the explicit hand-back path after safe saving lands.** Remove the button, pulse/toast,
  summary generation, endpoint, and waiting-loop completion event together with their callers.
  Preserve ordinary file watching and review counts. No legacy summary compatibility is required;
  remove summary-specific behavior without silently rewriting arbitrary document content on open.
- **Untangle assist lifetime from hand-back.** `open --wait` currently also enables translation
  service. Removing its wait loop must not silently remove translation. Either retain an independent
  agent adapter or choose cache preparation as the supported path before deleting queue machinery.
- **Retire `new` and draft-only machinery.** Trace rename and session rekey callers first; keep any
  operation that still supports an independently chosen file-management capability.
- **Retire the separate workspace UI and app-owned harness installer.** Replace their entry points
  with native file access and harness-owned installation guidance. Remove tree/badge/session code
  only after checking which pieces remain necessary for opening an agent-selected set of files.
- **Repair remaining protocol guidance with skill consolidation.** `AGENT_SETUP.md` still promises
  an absent revision diff. The architecture map was updated with the initial ablation; keep it
  aligned as later responsibilities move. Do not sweep unrelated comments.

## Desktop wrapper choice

Both candidates support macOS, Windows, and Linux. Cross-platform capability is a selection
requirement; packaging and native behavior still need testing on each platform.

- **Electron** embeds Chromium and Node. The existing React UI and Node filesystem/watch/cache code
  fit that process model. Proposed shape: privileged document operations in the main process,
  narrow preload IPC to the renderer, with no production HTTP server. This appears to
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

### Preserve the browser development loop

A desktop wrapper adds native integration to test; it need not remove browser iteration on the React
UI. Proposed constraint: keep the same UI runnable at a local development URL, with a narrow host
interface for file access, dialogs, and lifecycle. Use a development adapter or fixtures for that
interface; do not retain the production detached daemon solely to make previews work.

Codex's [built-in browser](https://learn.chatgpt.com/docs/browser?surface=app) can inspect, interact
with, and screenshot local web apps. Those checks cover typography, selection, comments, and layout.
Native dialogs, application menus, keyboard focus, file associations, and quit/reopen behavior still
need checks in the actual desktop app. Native accessibility/screenshot control is available in this
session, but browser DOM access to every wrapped webview should not be assumed.

[Playwright supports Electron automation](https://playwright.dev/docs/api/class-electron), currently
marked experimental; native dialogs need separate handling. [Tauri's testing guide][tauri-tests]
describes mock-runtime and end-to-end options, including a WebdriverIO route for macOS. Its mock
runtime does not execute native webviews. Neither framework makes browser-only tests sufficient.
Include actual macOS automation and the browser preview in the wrapper comparison before selection.

[tauri-tests]: https://v2.tauri.app/develop/tests/

### Comment lifecycle

Delete, Resolve, and the Resolved view are implemented. The versioned, hidden in-file record and
its compatibility rules live in [`review-archive.md`](../src/shared/review-archive.md). The codec
uses the existing Markdown parser and native JSON encoding; no new parser or HTML-rendering library
is needed. Regression cases cover byte preservation, safe escaping, active mark discovery,
translation exclusion, malformed records, stale actions, and undo. The external markup parser was
also checked against the emitted archive: historical marks remain inactive.

Receiving-agent guidance distinguishes active feedback from resolved history. Author-tagged agent
replies are now approved; the public convention must be self-contained and use neutral examples.
Port only the required protocol, confirming ambiguous private material before inclusion. Reopening
archived threads and relocating their anchors can wait for an actual need; undo covers immediate
accidental resolution.

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

Include the trial's cross-list insertion reproduction, author tags containing spaces, and comment
soft-line wrapping in that comparison. Preserve screenshot-only observations as such; the original
document is unavailable. See [trial notes](squad-fork.md#trial-notes) for evidence.

For frontmatter, [Obsidian Properties](https://obsidian.md/help/properties) is a useful prior: named
rows with values at the top, typed simple properties, and raw YAML/source mode for structures its
property UI cannot represent. Proposal: a quiet, read-only property list for simple keys and values,
with a source fallback for nested/unknown/invalid YAML. Keep bytes, key order, comments, and body
offsets intact. Do not turn display into a YAML rewrite or add a property editor in this arc.
The landed literal frontmatter support is the baseline; property-list display is the reviewed
presentation direction.

## Wishlist mapped to product work

- **One graphical onboarding flow:** combine setup, handle, repository-scoped language, optional
  comfort language, and a localized demo. Prefill invocation values, then settings/Git defaults as
  appropriate. Keep harness installation in its skill/package guidance. Preference precedence,
  first-run persistence, and the repository-settings storage/discovery mechanism remain open.
- **One review skill:** replace separate setup/demo entry points with the normal launch flow. Blend
  the existing file-review instructions with the approved author-tagged reply and resolution
  conventions. Publish self-contained guidance suitable for every supported harness.
- **Smart open:** the session agent has full discretion over the files needing review now. Provide
  a deterministic operation to open its chosen paths; do not encode a Git-only or session-only
  eligibility rule. Git is useful context and is optional. Multi-file UI details remain open.
- **Continuous saving:** use the file-safety work above as the prerequisite to deleting hand-back.
  Optional Git commits remain a separate proposal, with file scope and timing unresolved; autosave
  should not implicitly stage or commit unrelated repository changes.
- **Translation and squad configuration:** support repo-language-only operation and an optional
  comfort language, with translations supplied by the invoking agent. Decide nonblocking opening
  when translation is enabled, live versus prepared translation, and how repo settings are stored
  and discovered before changing those contracts. Comfort language remains a personal preference.
- **Package identity:** choose the name before distribution changes; package, executable, and config
  migration still need a ruling. A wrapper does not remove collisions with upstream automatically.
- **Claude Code Mods:** retain as an aspiration. Anthropic's
  [official examples][mods] confirm that mods can draw panes and react to the session. This does not
  establish that the existing DOM-based reviewer can be embedded unchanged. A future compatibility
  study must check the terminal/desktop render APIs, selection, input, and accessibility. Keep the
  document core independent of that integration; do not make the wrapper wait for it.

[mods]: https://github.com/anthropics/claude-code-playground/blob/main/claude-code/mods/README.md

## Reviewed implementation sequence

The first approved implementation arc is document/save ownership and obsolete-code removal. Keep
the scope small enough to validate before beginning the wrapper or broader product changes.

1. **Reproduce save failures and settle conflict interaction.** Add controlled cases for navigation,
   out-of-order responses, edits during saves, and external changes. Investigate the intermittent
   translation-cache test failures seen during documentation-only runs so failures in later arcs
   are attributable. Propose a fixed conflict notice opening base/local/disk comparison;
   pause conflicting writes while preserving local edits. Review the detailed interaction before
   building it. Exit: reproduced failures, expected outcomes, and an approved conflict flow.
2. **Fix ownership, then remove dead machinery.** Land isolated fixes with failing-before and
   passing-after tests. Remove obsolete serialization, pass-through feedback handling, and recurring
   legacy-history deletion in separate commits; repair their module maps. Exit: pending writes and
   undo belong to the right document, edits survive navigation and slow saves, and obsolete paths
   have no remaining callers.
3. **Make the trial comfortable.** Address input selection contrast, author-label consistency, and
   comment soft wraps in tested fixes. Preserve paragraph breaks and source bytes. Characterize
   the cross-list insertion separately: the lost original cannot establish its exact cause, and
   invalid multi-block marks must not silently become accepted edits. Validate narrow-window chrome
   in the browser development view; a wrapper alone does not fix that preview. Exit: targeted
   regressions plus visual checks across themes and representative viewport sizes.
4. **Settle and implement the file protocol.** Review the archive proposal above alongside
   translation opening/lifetime and the minimal agent
   launch interface. Agent replies and dropping legacy compatibility are ruled. Delete/Resolve
   have shipped; align the remaining skill guidance with the public reply convention. Exit: app and receiving
   agent agree on active versus historical feedback; translation does not accidentally depend on a
   removed completion loop.
5. **Compare and select the desktop host.** Use the reduced document service for the bounded wrapper
   experiment, including browser preview and native macOS automation. Record the choice with a
   credible Windows/Linux packaging path. Retire daemon and browser-choice machinery only when their
   responsibilities have a tested owner. Exit: measured comparison and a wrapper ruling.
6. **Build the chosen review flow.** Implement native file access, multi-file review, graphical
   onboarding, skill consolidation, and hand-back removal against settled contracts. App session
   state ends on quit; restoration is deferred. Evaluate frontmatter rows and renderer replacement
   independently. Choose package identity before distribution. Optional Git commits and Claude Mods
   remain deferred. Exit: a teammate can open, review, save, and revisit chosen files without
   operating the CLI or handing files back individually.

Each implementation commit must pass the full test suite and both typechecks. Run the corpus and
byte-preservation cases when touching Markdown, selection, or writes; preserve fixture bytes. Build
before CLI/manual review. Wrapper validation must include external edits, missing paths, window
close/reopen, and actual platform builds, not just a framework's support list.

Execution is approved. The first batch delivered document-owned buffers and save scheduling,
version-checked file writes, the initial ablation, and the three small comment-display fixes. Tests
cover the previously failing schedules; a browser smoke check exercised source autosave, clean
external reload, author labels, soft wraps, and selected input text. The next batch added guarded
conflict comparison and hidden resolved discussions with per-comment deletion. Cross-list mark
handling, responsive chrome, wrapper selection, and the explicitly open contracts remain ahead.
