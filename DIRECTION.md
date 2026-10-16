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

## 2026-10-15 — Comment-card design

**Open question.** Compare a compact card, a margin note, and a conversation layout before replacing
the existing comment sidebar. The treatments and interaction references are in
[reading and review refinement](docs/reading-and-review.md).

**Exit:** a selected treatment ships, with its semantics recorded beside the comment renderer.

## 2026-10-14 — Native file picker latency

**Deferral.** macOS panel creation and sheet presentation dominate the observed delay. Retaining
the panel reduced a repeat-open trace from about 460 ms to 285 ms but did not improve first open.
The pinned dialog library does not expose reuse; avoid adding a separate macOS picker for now.
Measurements and the experiment are in [picker latency](desktop/picker-latency.md).

**Exit:** a library-supported optimization or an approved native implementation improves measured
latency without changing file admission, or the remaining delay is accepted.

## 2026-10-10 — Restoring app sessions is deferred

**Deferral.** Review-session state currently targets the app's lifetime. Restoration and a possible
SQLite implementation are later options; no database or alternate review-feedback store is adopted.

**Exit:** a concrete restoration need and a ruling on persisted state, storage, and the existing
no-database invariant, or the option is dropped.

## 2026-10-13 — Native release hardening

**Gap.** Tauri is adopted. Remaining desktop interactions, filesystem coverage, installation, and
platform input checks are recorded once in [native validation](tools/desktop/results.md).
Adoption is not a claim that these release checks have passed.

**Exit:** the relevant checks pass before a release claims their support, or their scope is
explicitly revised.

## 2026-10-10 — Repository language settings (updated 2026-10-10)

**Open question.** Project language and personal translation language have settled roles, but
repository settings still need storage, discovery, precedence, and defaults outside a repo.
Translation uses explicit preparation languages and an optional personal translation preference;
that does not choose a repo-settings mechanism.

**Exit:** a ruling and implementation for repository settings, or that mechanism is dropped.

## 2026-10-10 — Package and CLI identity (updated 2026-10-13)

**Open question.** The npm project is private and retains the inherited name `mastermind-md`.
The native app identifier and executable names remain provisional. Select public command, package,
and settings
identity before distributing or installing alongside
[Mastermind](https://github.com/Jingquank/Mastermind).
The repository launcher does not install a global command.

**Exit:** a distribution-identity ruling applied to packaging, launcher installation, and native
settings storage.

## 2026-10-10 — Markdown wrapping stays manual

**Deferral.** Project Markdown is hard-wrapped at 100 columns by hand. Automatic formatting must
exclude `tests/fixtures/*.md`, whose bytes are inputs to round-trip tests. No wrapping hook is
installed.

**Exit:** a formatter with path exclusions is adopted, or the wrapping requirement is dropped.
