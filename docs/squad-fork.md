---
status: living
updated: 2026-10-10
exit: the light track has landed, the heavy track's items are each a ruling in DECISIONS.md or dropped, and upstream's rationale is distilled here
---
# The squad fork

Mastermind forked at upstream `3687c91` (v0.2.1) to re-optimize it for a three-person squad whose
review loop runs on CriticMarkup written into the document. Upstream is slow-moving and
single-author, so heavy changes land here rather than as pull requests; small fixes stay in
upstream-shaped commits so they remain sendable.

## What upstream got right

To be written: the distillation of [`product.md`](product.md),
[`../themes/README.md`](../themes/README.md), and
[`upstream-behaviors-plan.md`](upstream-behaviors-plan.md) into what the squad keeps and why, before
any heavy change (see `DIRECTION.md`).

## Light track — upstream-shaped fixes, one commit each

Found in the first day of use. Each is small, uncontroversial, and separable.

- Frontmatter: the renderer has no handling for a YAML block; every squad doc opens with one.
- Author tag: the default is upstream's author's initials (`DEFAULT_AUTHOR_TAG` in
  `src/shared/constants.ts`). Prompt at first run or fall back to `git config user.name`.
- The "Open in browser" preference picks which browser app to launch (`src/server/browsers.ts`); the
  English label describes an action. The Chinese label already says the right thing.
- Settings panel text is selectable; the one `user-select: none` in `src/ui/app/app.css` does not
  cover it.

## Heavy track — candidates, not yet ruled

Each becomes a `DECISIONS.md` ruling before it is built, or is dropped.

- Translation available on demand, never a gate on `open`; language pair per user at first run.
- Agent-authored comments in the file (the squad's convention) versus upstream's one-direction
  marks, including how the renderer shows an agent's reply.
- App-mode launch (`--app=` / web manifest) as the default container.
- Package, CLI, and config-directory rename.
- Squad-level configuration: a shared default for the review convention and language pair, with
  per-user author tags.

## Trial notes

Add dated observations from squad use here; move anything that becomes a ruling or a direction entry
out as it settles.

- 2026-10-10 — `npx mastermind-md open --no-translate <file>` is the working invocation; a bare path
  is parsed as an unknown command. The reading surface itself reads well.
