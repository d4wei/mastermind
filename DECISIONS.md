# Decisions

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
