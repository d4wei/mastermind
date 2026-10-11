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
