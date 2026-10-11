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

The squad keeps the following design commitments from
[`product.md`](product.md) and [`../themes/README.md`](../themes/README.md):

- **"The file on disk is the protocol."** A plan, its CriticMarkup feedback, and the hand-back
  summary travel together. A teammate or coding agent can participate with a text editor; the
  review does not depend on an account, a service, or a second store of discussion state.
- **"Reviewer-grade reading experience" and "the document column is sacred."** Typography,
  reading measure, and the margin rail serve long sessions of thinking about a document. Keep
  the quiet reading surface, keyboard shortcuts, and restrained chrome; a three-person audience
  does not call for a dashboard or another toolbar.
- **"Swiss International, in service of reading."** Keep flat surfaces, hairline rules, generous
  spacing, and theme tokens. Accent belongs to controls; review marks carry semantic color in the
  document. The optional code-color preference remains an explicit exception. User-selectable
  fonts and themes support different readers without changing the document's content.
- **"Marks are the data."** Review actions hang off source spans, and accepting a mark is an exact
  splice. Keep byte-preserving source edits and the revision diff: readers can inspect what changed
  without a Markdown serializer rewriting unrelated text. Who may author a mark remains an open
  heavy-track question below.
- **"Local, fast, silent" and the hand-back loop as "the product's spine."** Keep one reviewed file
  per session, a stable CLI signal, and a summary in the file. Agents consume the file and stdout,
  not the UI. The same loop remains legible with three people taking turns.

The historical behaviors plan at upstream `3687c91` adds integration rationale worth retaining:

- **"CLI does everything deterministic."** Skills ask the person, supply language judgment, and
  call shared primitives. Keep the thin harness adapters and shared browser-safe registries so
  different coding agents do not grow divergent implementations of configuration or cache keys.
- **"The agent is the translator."** Offline cache preparation avoids asking one process to drive
  a review and answer its own live translation requests. Hash-keyed blocks reuse unchanged work;
  shared segmentation and target-language selection keep CLI-written entries compatible with the
  browser. Retain that useful preparation path and the bilingual toggle. Whether preparation may
  gate opening is a separate, unresolved squad decision.
- **One preferred/secondary language pair.** Setup and the reading toggle share `langPair`, rather
  than maintaining competing preferences. Two squad members benefit directly from the second
  reading language; there is no reason to discard the feature with its upstream defaults.
- **Portable, reversible provisioning.** Skills target multiple coding harnesses through the same
  CLI; global instruction blocks have explicit markers and an uninstall path. Preserve that
  boundary and avoid growing agent-specific hooks where ordinary instructions suffice.

The historical plan has been distilled here and deleted. These are reasons to preserve working
parts of the fork, not retrospective entries in `DECISIONS.md`.

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
