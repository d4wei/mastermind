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

## 2026-10-10 — Restoring app sessions is deferred

**Deferral.** Review-session state currently targets the app's lifetime. Restoration and a possible
SQLite implementation are later options; no database or alternate review-feedback store is adopted.

**Exit:** a concrete restoration need and a ruling on persisted state, storage, and the existing
no-database invariant, or the option is dropped.

## 2026-10-10 — Architecture contracts still open after review (updated 2026-10-10)

**Open question.** The reviewed [plan](docs/architecture-review.md) still leaves wrapper selection,
summary compatibility, and the agent launch interface unresolved.
These choices determine which existing paths can be removed and where their responsibilities go.

**Exit:** those contracts receive rulings and graduate into their implementations or are dropped.

## 2026-10-10 — Agents answering in the file versus upstream's one-direction marks

**Open question.** Upstream's setup block forbids agent marks; another section permits replies.
The squad convention uses consecutive harness-tagged replies. The conflicts and author-neutral
renderer support are inventoried in [`docs/squad-fork.md`](docs/squad-fork.md).

**Exit:** a `DECISIONS.md` ruling, with the shipped skills, `AGENT_SETUP.md`, and the renderer's
treatment of agent-authored comments brought to match.

## 2026-10-10 — Translation opening and interaction (updated 2026-10-10)

**Open question.** Single-language operation and repo/comfort language roles are settled. When
translation is enabled, cold-cache opening, live versus prepared translations, and review against a
translated view remain unresolved. See the [current behavior](docs/architecture-review.md).

**Exit:** rulings on nonblocking opening, translation delivery, source anchoring for review, and
storage/discovery/precedence for repository settings. Repo language is repo-scoped; comfort language
is personal, as ruled in `DECISIONS.md`.

## 2026-10-10 — Package and CLI identity

**Open question.** The fork still publishes as `mastermind-md`, installs `mastermind`, and writes
`~/.config/mastermind`, so a teammate with both upstream and the fork installed collides on all
three.

**Exit:** a ruling on the name, applied to `package.json`, the bin, and the config directory.

## 2026-10-10 — Markdown wrapping stays manual

**Deferral.** The squad's operating docs are hard-wrapped at 100 columns, but the rewrap pre-commit
hook reflows every staged `.md`, and `tests/fixtures/*.md` must stay byte-exact for the round-trip
tests. Until the hook can exclude paths, wrapping is by hand.

**Exit:** the rewrap engine gains a path exclusion and the hook is installed, or the squad rules
that unwrapped Markdown is fine.

## 2026-10-10 — The product doc describes upstream's owner

**Gap.** [`docs/product.md`](docs/product.md) names upstream's author as the one user and cites a
spec file that is not in the repo. The squad has three users, a different language mix, and a shared
review loop.

**Exit:** `docs/product.md` re-baselined for the squad, with the stale citation removed.
