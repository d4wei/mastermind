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

## 2026-10-10 — Agents answering in the file versus upstream's one-direction marks

**Open question.** Upstream's invariant is that marks flow user → agent only: the shipped skills
tell an agent never to add CriticMarkup, and the agent's changes show through the revision diff. The
squad's review convention has an agent answer a comment in place with a consecutive
`{>>@<harness>: …<<}`, so a question can be answered without a document change. The two cannot both
hold.

**Exit:** a `DECISIONS.md` ruling, with the shipped skills, `AGENT_SETUP.md`, and the renderer's
treatment of agent-authored comments brought to match.

## 2026-10-10 — Translation: wanted by the squad, but never a gate on opening

**Open question.** Two of three squad members read Chinese more comfortably, so the bilingual toggle
is a feature, not a quirk. But `open` refusing a cold translation cache turns every open into an
agent translation round or a `--no-translate` flag, and the default language pair is hardcoded to
upstream's author.

**Exit:** a ruling on the default — translation available on demand, open never blocked — and the
per-user language pair set at first run.

## 2026-10-10 — The browser is the container until the squad says otherwise

**Bet.** A standalone shell (Tauri, Electron) is the expensive end of a ladder whose cheap rungs —
Chromium `--app=` mode, Safari's Add to Dock, a web manifest for Chrome's install — give a
chromeless window with a Dock entry for no build cost. The tool's form-factor problem may be fully
solved there.

**Exit:** a week of squad use on app mode; a named failure of the browser container sizes a shell,
or the bet is deleted.

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
