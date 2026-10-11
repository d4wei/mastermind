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

## 2026-10-10 — Architecture ablation and the wishlist need a reviewed plan

**Gap.** The product directions are settled in `DECISIONS.md`; their implementation is not.
[`docs/architecture-review.md`](docs/architecture-review.md) maps the current system, deletion
candidates, file-safety risks, and remaining choices, including wrapper selection and onboarding.

**Exit:** the user reviews the plan and rules on the choices needed by its first implementation arc.

## 2026-10-10 — Agents answering in the file versus upstream's one-direction marks

**Open question.** Upstream's setup block forbids agent marks; another section permits replies.
The squad convention uses consecutive harness-tagged replies. The conflicts and author-neutral
renderer support are inventoried in [`docs/squad-fork.md`](docs/squad-fork.md).

**Exit:** a `DECISIONS.md` ruling, with the shipped skills, `AGENT_SETUP.md`, and the renderer's
treatment of agent-authored comments brought to match.

## 2026-10-10 — Translation: wanted by the squad, but never a gate on opening

**Open question.** Two of three squad members read Chinese more comfortably, so the bilingual toggle
is a feature, not a quirk. But `open` refusing a cold translation cache turns every open into an
agent translation round or a `--no-translate` flag, and the default language pair is hardcoded to
upstream's author.

**Exit:** a ruling on the default — translation available on demand, open never blocked — and the
per-user language pair set at first run.

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
