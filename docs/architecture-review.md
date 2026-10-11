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

Translation preparation and delivery are implemented. The command emits every block for a fresh
preparation; `--save` publishes one complete, validated reading artifact. Opening always shows the
original immediately. There is no live queue, separate translator, waiting loop, or old-cache
reader.

A block is a source slice derived from a top-level Markdown node; lists split into individual items.
The durable projection, freshness, and quoted-comment contracts live in
[`translation.md`](../src/shared/translation.md). Artifact storage, publishing, and the CLI/API
contract live in [`prepared.md`](../src/server/translate/prepared.md). The public preparation flow
lives in [the shipped skill](../.claude/skills/mastermind/SKILL.md).

### Translation without a live service

The preparing agent supplies a complete fresh translation using its existing context. The app
checks the current narrative snapshot, not the repository's Git HEAD or an inferred dependency
list. Comments and resolved history remain in their authored language; source prose and proposed
edits invalidate the prepared translation. Block-anchored comments preserve the exact translated
selection and its language in the original file. These contracts have graduated to the sidecars
above and the rulings in `DECISIONS.md`.

The app cannot establish that the agent considered every relevant contextual dependency. Context
selection remains the agent's responsibility; preparing again does not eliminate semantic drift.
Repository language settings still need storage, discovery, and precedence. The current command
requires explicit source and target languages; comfort language is an optional personal preference.

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
file I/O and watching, and maintains sessions. Removing hand-back alone does
not eliminate those responsibilities; the desktop host takes them over.

The target is an editor-style app whose wrapper owns its runtime and review-session state. Remove
the detached daemon and its status/stop workflow once those responsibilities run under the app's
lifetime. Review-session state is in memory and ends when the app quits; saved Markdown remains on
disk. Existing preferences and prepared translation files are separate from session restoration, and
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

Hand-back, generated summaries, waiting-loop events, assist dispatch, and live translation have now
been removed together. Ordinary watching and autosaving remain. Existing document bytes are not
silently cleaned up on open. The public skill supports author-tagged replies and fresh preparation.

- **Retire `new` and draft-only machinery.** Trace rename and session rekey callers first; keep any
  operation that still supports an independently chosen file-management capability.
- **Retire the separate workspace UI and app-owned harness installer.** Replace their entry points
  with native file access and harness-owned installation guidance. Remove tree/badge/session code
  only after checking which pieces remain necessary for opening an agent-selected set of files.
### Root Markdown cleanup in the ablation

Inventory checked at `7ae2863`. Keep root entry points and canonical ledgers; do not relocate every
file into a general documentation bucket. No scratch document below is consumed by the automated
suite. Existing files under `tests/fixtures/` remain byte-exact.

- **Keep:** `README.md`, `AGENTS.md`, `CLAUDE.md`, `DIRECTION.md`, and `DECISIONS.md`. Each is a
  repository entry point or canonical operating ledger, rather than a loose topic document.
- **Retire `dummy-plan.md`:** a disposable theme-toggle mock with fictional paths and an obsolete
  generated summary. The bundled demo already supplies a maintained starting point.
- **Retire `sample-doc.md`:** another disposable migration-plan example, with no tracked consumers.
  Keep the shipped demo and tested corpus rather than another unsupervised copy.
- **Move and tighten `feature-test.md` into `tests/manual/review-interactions.md`:** preserve the
  deliberate cross-block and callout examples as a manual exercise, remove the false one-direction
  claim, and use durable expected outcomes. It is not a byte-exact automated fixture. Update the
  historical pointer in `docs/squad-fork.md` so the original trial remains understandable.
- **Fold `AGENT_SETUP.md` into `assets/agent/README.md`:** keep installation/removal explanation
  beside the packaged agent assets; link the actual skill and protocol instead of duplicating them.
  Update the root README, plan-review instruction, CLI help pointer, and historical inventory.
  The installer remains until its separately approved retirement has a replacement entry point.
- **Retire `.impeccable.md`:** it is an upstream landing-page brief, including obsolete hand-back,
  one-direction review, and npm-release claims. Its durable app design rationale already lives in
  `themes/README.md`. Preserve only still-applicable site-specific rationale in `site/README.md`
  beside the Astro site; do not transplant upstream personal preferences as squad requirements.

Check incoming links and any tool discovery contract before each deletion or move. No installed
plugin behavior is inferred merely from a dotfile name. Review the retained site prose with the
site itself; this cleanup does not publish or redesign the landing page. Retiring a source reference
requires fixing its callers in the same commit. Delete this inventory once those changes land;
durable guidance belongs at the destination.


## Desktop wrapper choice

Research checked on 2026-10-10 against the reduced implementation at `7ae2863`. The subsequent
wrapper ruling lives in [DECISIONS.md](../DECISIONS.md). The comparison below preserves the
tradeoffs; the remaining validation plan now targets Tauri with native file services.

### The architecture both candidates should serve

The app needs a privileged local host for file access, watching, dialogs, opening paths from an
agent, and save-aware shutdown. It does not need a production HTTP listener or detached daemon.
The browser engine draws the React interface; the host performs privileged operations through a
small bridge. IPC means messages between those app processes, not a remote backend.

Keep the Markdown parser, exact-splice review core, translation projection, and document buffers
in TypeScript. Put version-checked file reads/writes and watching behind a narrow host interface.
Move responsibilities, not the Hono routes, port scanning, health probes, or idle-daemon lifecycle.
The current contracts in `src/server/files.md` and `src/ui/app/store.md` remain the acceptance bar.
A native file plugin's plain read/write calls do not by themselves replace those contracts.

The same React surface should run at a local development URL through a development adapter.
That preserves browser iteration without making an HTTP server part of the shipped desktop app.
Native open/save/quit behavior must also run against the real packaged host.

### Electron: strongest fit with the current implementation

[Electron][electron-process] bundles Chromium and Node. Its main process can run the existing Node
file services; the renderer keeps React and CodeMirror. Expose specific document operations through
an isolated preload bridge, following [Electron's IPC guidance][electron-ipc], rather than exposing
arbitrary filesystem or IPC access to rendered document content.

For this codebase, that means adapting the existing `files.ts`, `watch.ts`, config, and artifact
services instead of rewriting them in another language. A consistent Chromium renderer reduces
engine variation in selection, geometry, CodeMirror, and Chinese text input, although operating
system differences still require testing. These are repository-specific advantages, not measured
claims about our future desktop build.

The cost is carrying a browser and Node runtime for a small document utility. Package size, total
process memory, startup, and update burden matter; no size or memory estimate is established here.
Electron itself does not require keeping our HTTP server. Its host owns the application lifetime.

[Playwright's Electron support][electron-tests] drives the real application and is currently
experimental. Browser tests remain useful, but native dialogs, menus, focus, and quit handling need
separate checks. This is the shortest apparent route to reuse our existing implementation and tests.

### Tauri with native file services: a credible smaller-runtime alternative

[Tauri][tauri-architecture] uses a Rust host and system webviews. It avoids shipping Chromium by
default. [Its process model][tauri-process] uses different webview implementations across platforms;
that makes our actual selection and editing behavior a required comparison, not an assumed match.
The React/TypeScript document core can remain intact; choosing Tauri does not mean rewriting the UI
or CriticMarkup parser in Rust.

Tauri's [filesystem plugin][tauri-fs] supplies reads, writes, watching, and path scopes. The missing
work is our application-specific file contract: version tokens, competing writes, symlink and inode
behavior, watcher echoes, and save completion before close. Implement that in a focused native
service and port its behavioral tests. Avoid rebuilding the retired workspace or queue machinery.

The strongest argument for Tauri is the final product: a small local document utility with a narrow
native boundary. The strongest argument against it is that we have just stabilized precisely the
file-safety code that would need porting. Rust is an additional implementation and build toolchain;
its presence is neither a disqualifier nor a reason to rewrite more than this boundary needs.
Do not overstate that port: the current file read/write and watcher modules together occupy only
140 lines at the inspected revision. That is not an effort estimate, but it argues against choosing
Electron merely because Node code already exists. The difficult part is preserving behavior.

Current [Tauri WebDriver guidance][tauri-tests] supports macOS through WebdriverIO's embedded
provider, alongside Windows and Linux. The older claim that desktop macOS automation is unavailable
is too broad. Include that debug-only integration in the experiment; do not ship an automation
server in release builds. Its reliability for our app remains unmeasured.

### Other shapes considered

- **Tauri with a Node sidecar:** [supported][tauri-sidecar], and it could reuse file services. It
  adds the Rust host, a packaged Node process, and another lifecycle/communication boundary. It
  need not use HTTP, but for our reduced app it weakens the reason to prefer Tauri. Keep it out of
  the implementation; a concrete native-port blocker would require revisiting the wrapper ruling.
- **Electrobun:** worth knowing about, but not the initial baseline. Its current
  [platform guide][electrobun] offers system webviews or bundled CEF and requires native
  build/test runners; its published architecture matrix has caveats, including no macOS x64 core
  artifact in the documented release workflow. We have not validated its runtime compatibility,
  lifecycle, or automation against this app. It earns a trial if the two main candidates both fail
  a requirement; a framework change alone is not a product benefit.
- **Neutralinojs:** [its architecture][neutralino] uses HTTP for resources and WebSockets for native
  calls. That is a weak match for the desired removal of the server-shaped runtime, even though the
  server is local. No first-round experiment recommended.
- **A custom macOS-only shell:** conflicts with the approved cross-platform direction. A native UI
  rewrite would also discard the web rendering/selection layer we intend to keep.

### Validate the selected host

The remaining work is to validate the native file boundary and the review UI across webviews.
Generic framework benchmarks cannot establish those behaviors for this app. Cross-platform support
provides a path, not free release validation. [Tauri][tauri-distribution] still requires packaging,
signing, and actual platform tests.

Bounded validation before replacing the existing host:

1. Run the current React UI and corpus in one Tauri host. Pin the dependencies. Start with one
   window and chosen files; onboarding and a new navigation design remain separate work.
2. Exercise unchanged CRLF round trips, exact mark splices, translated quotes, external replacement,
   conflicting writes, two open documents, slow saves, and a failed save during attempted quit.
   Verify file permissions/symlinks and all affected document bytes, not just visible success.
3. Open multiple paths from an agent with the app cold and already running. The launcher returns
   after files are accepted for opening; it does not wait for review completion. Finder opening and
   drag/drop are separate native entry points to the same operation.
4. Test Chinese IME composition, selection across formatted text, comment popover placement,
   keyboard shortcuts, file dialogs, and focus in the real macOS app. Demonstrate an automated
   desktop smoke test and the ordinary browser preview.
5. Measure packaged size, cold open-to-readable time, aggregate idle memory across app processes,
   and native code/adapter complexity using identical documents and repeated runs. Record hardware,
   build mode, framework versions, and the measurement method with the results.
6. Build and smoke-test Windows and Linux packages on native runners before claiming portability.
   A missing runner is an explicit evidence gap. Launching a blank window does not establish that
   the review and file-safety contracts survive the host change.

Keep the native service focused and review the measured footprint without weakening file safety or
review interactions. No numerical performance threshold is invented before seeing the baseline;
agree a threshold if measurements expose a real tradeoff. A concrete correctness or portability
blocker warrants revisiting the ruling.

[electron-process]: https://www.electronjs.org/docs/latest/tutorial/process-model
[electron-ipc]: https://www.electronjs.org/docs/latest/tutorial/ipc
[electron-tests]: https://playwright.dev/docs/api/class-electron
[tauri-architecture]: https://v2.tauri.app/concept/architecture/
[tauri-process]: https://v2.tauri.app/concept/process-model/
[tauri-fs]: https://v2.tauri.app/plugin/file-system/
[tauri-tests]: https://tauri.app/develop/tests/webdriver/
[tauri-sidecar]: https://v2.tauri.app/learn/sidecar-nodejs/
[tauri-distribution]: https://v2.tauri.app/distribute/
[electrobun]: https://framework.blackboard.sh/electrobun/guides/cross-platform-development/
[neutralino]: https://neutralino.js.org/docs/contributing/architecture/

### Comment lifecycle

Delete, Resolve, and the Resolved view are implemented. The versioned, hidden in-file record and
its compatibility rules live in [`review-archive.md`](../src/shared/review-archive.md). The codec
uses the existing Markdown parser and native JSON encoding; no new parser or HTML-rendering library
is needed. Regression cases cover byte preservation, safe escaping, active mark discovery,
translation exclusion, malformed records, stale actions, and undo. The external markup parser was
also checked against the emitted archive: historical marks remain inactive.

Receiving-agent guidance distinguishes active feedback from resolved history. Author-tagged agent
replies use the self-contained [public protocol][public-protocol]. The shipped instructions use
neutral examples and require no private skill or helper. Reopening
archived threads and relocating their anchors can wait for an actual need; undo covers immediate
accidental resolution.

[public-protocol]: ../.claude/skills/mastermind/reference/review-protocol.md

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
- **Continuous saving:** autosave has replaced explicit hand-back.
  Optional Git commits remain a separate proposal, with file scope and timing unresolved; autosave
  should not implicitly stage or commit unrelated repository changes.
- **Translation and squad configuration:** support repo-language-only operation and an optional
  comfort language, with fresh translations supplied by the invoking agent. Nonblocking opening
  and prepared delivery have shipped. Repository settings still need storage and discovery;
  comfort language remains a personal preference.
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
   translation opening/lifetime and the minimal agent launch interface. Agent replies and dropping
   legacy compatibility are ruled. Delete/Resolve, public replies, and fresh translation
   preparation have shipped. Exit: app and receiving agent agree on active versus historical
   feedback; translation does not accidentally depend on a removed completion loop.
5. **Compare and select the desktop host.** Use the reduced document service for the bounded wrapper
   experiment, including browser preview and native macOS automation. Record the choice with a
   credible Windows/Linux packaging path. Retire daemon and browser-choice machinery only when their
   responsibilities have a tested owner. Exit: measured comparison and a wrapper ruling.
6. **Build the chosen review flow.** Implement native file access, multi-file review, graphical
   onboarding, and the graphical setup/demo flow against settled contracts. App session
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
conflict comparison and hidden resolved discussions with per-comment deletion. Fresh prepared
translation, translated-view comments, public reply guidance, and removal of
hand-back and the live service followed. Cross-list mark handling, responsive chrome, wrapper
selection, and the explicitly open contracts remain ahead.
