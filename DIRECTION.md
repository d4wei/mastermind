# Direction

- Add only an unresolved question, deliberate deferral, or directional bet that is not yet true in
  the project and has both a why and an exit condition.
- Do not use this file as a task backlog. Reject entries that lack a why or a condition that removes
  them.
- Move a settled choice to `DECISIONS.md`; move a built contract into the code and its colocated
  docs; delete a dropped entry. Record a dropped choice only when it constrains future work.
- Keep each entry to a few lines. Move self-contained depth to `docs/<topic>.md` and leave one
  pointer here.
- Add the newest entry directly below the divider. Append `(updated YYYY-MM-DD)` to the heading
  after a substantive edit.

Use this entry shape:

```
## YYYY-MM-DD — <title>

**<Bet | Deferral | Open question | Gap>.** <why it remains open.>

**Exit:** <the ruling, build, or measurement that resolves it.>
```

Before adding or editing an entry, cross-check `DECISIONS.md` and the project, then graduate every
entry that has already resolved.

* * *

## 2026-10-10 — Product terminology is under review

**Open question.** Language preferences, document sessions, and several review concepts still use
overloaded or development-era names. The [terminology exercises](docs/terminology-review.md) propose
public labels and precise technical terms without changing their behavior or file formats.

**Exit:** the naming choices are accepted or rejected and adopted names live with their features.

## 2026-10-10 — Restoring app sessions is deferred

**Deferral.** Review-session state currently targets the app's lifetime. Restoration and a possible
SQLite implementation are later options; no database or alternate review-feedback store is adopted.

**Exit:** a concrete restoration need and a ruling on persisted state, storage, and the existing
no-database invariant, or the option is dropped.

## 2026-10-10 — Architecture contracts still open after review (updated 2026-10-10)

**Open question.** The [architecture plan](docs/architecture-review.md) leaves the agent launch
interface unresolved. Tauri is selected in `DECISIONS.md`; the launch contract determines how an
agent passes files and optional setup values into the running app.

**Exit:** the launch contract receives a ruling and graduates into its implementation or is dropped.

## 2026-10-10 — Repository language settings (updated 2026-10-10)

**Open question.** Repo language and personal comfort language have settled roles, but repository
settings still need storage, discovery, precedence, and defaults outside a repo. Translation now
uses explicit preparation languages and an optional personal comfort preference; that does not
choose a repo-settings mechanism.

**Exit:** a ruling and implementation for repository settings, or that mechanism is dropped.

## 2026-10-10 — Package and CLI identity

**Open question.** This repository retains the package name `mastermind-md`, the `mastermind`
command, and `~/.config/mastermind` configuration path from
[Jingquank/Mastermind](https://github.com/Jingquank/Mastermind). Installing both versions creates
collisions on all three.

**Exit:** a ruling on the name, applied to `package.json`, the bin, and the config directory.

## 2026-10-10 — Markdown wrapping stays manual

**Deferral.** Project Markdown is hard-wrapped at 100 columns by hand. Automatic formatting must
exclude `tests/fixtures/*.md`, whose bytes are inputs to round-trip tests. No wrapping hook is
installed.

**Exit:** a formatter with path exclusions is adopted, or the wrapping requirement is dropped.
