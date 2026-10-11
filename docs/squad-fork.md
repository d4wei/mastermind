---
status: living
updated: 2026-10-10
exit: every heavy-track item is ruled in DECISIONS.md or dropped
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

The four fixes from the first day of use have landed in separate upstream-shaped commits:

- Frontmatter renders as literal metadata while source bytes and body offsets remain intact.
  Metadata is excluded from review marks and translation; see
  [`frontmatter.md`](../src/shared/markdown/frontmatter.md).
- An unset author tag defaults to the global Git name, normalized for CriticMarkup, with
  `reviewer` as the fallback. Existing tags remain configured; see
  [`config.md`](../src/server/config.md).
- The English browser preference reads "Browser"; the Chinese label is unchanged. Its behavior
  remains choosing which application opens review URLs.
- Settings labels resist accidental selection. Author and language-search inputs remain
  selectable and editable.

## Heavy track — candidates, not yet ruled

Each becomes a `DECISIONS.md` ruling before it is built, or is dropped.

- Translation available on demand, never a gate on `open`; language pair per user at first run.
- Agent-authored comments in the file (the squad's convention) versus upstream's one-direction
  marks, including how the renderer shows an agent's reply.
- App-mode launch (`--app=` / web manifest) as the default container.
- Package, CLI, and config-directory rename.
- Squad-level configuration: a shared default for the review convention and language pair, with
  per-user author tags.

### Agent-authored comments: current assumptions and existing support

Inspection on 2026-10-10, after the light fixes. This is an inventory for a future ruling, not a
change to the review protocol. The shipped instructions conflict; the renderer does not enforce a
human-only author role.

**Instruction surfaces**

- [`AGENT_SETUP.md`](../AGENT_SETUP.md), "Plan reviews via Mastermind": the pasteable block calls
  marks the user's feedback, requires direct revision and removal of resolved marks, explicitly
  says "Do not add CriticMarkup of your own," and presents the revision diff as the way to see
  agent changes. This is the explicit prohibition that an in-file answer would violate.
- The same file, "How the protocol behaves": the comment-thread bullet explicitly shows
  `{==span==}{>>@ke: question<<}{>>@agent: answer<<}` and tells the agent to append a reply, while
  preferring direct revision. That already permits the opposite behavior. Its translation
  instructions preserve author tags without assigning a human or agent role.
- [The main shipped skill](../.claude/skills/mastermind/SKILL.md), "Visualize flow," step 4:
  the plan-review path tells the agent to apply or argue each mark and comment, remove resolved
  marks and the summary, then reopen until approved. It does not say where an argument lives or
  when an answered thread stays. Unlike the setup block, it contains no explicit ban on adding
  marks. The demo path localizes the bundled template and preserves its marks.
- [The demo template](../.claude/skills/mastermind/reference/demo.md), opening blockquote:
  "Marks flow one direction only: you annotate, the agent re-reads." The comment and deletion
  examples are notes for the agent; there is no agent reply example.
- [The alias skill](../.claude/skills/master/SKILL.md) delegates to the main Visualize flow; it
  adds no independent mark-direction rule.
- [The global block](../assets/agent/global.md) routes plans through the main skill and `--wait`
  and preserves CriticMarkup during translation. It has no explicit human-only mark rule and no
  instructions for answering or retaining a thread. A protocol change must account for this
  indirection, rather than treating this file as a second explicit prohibition.

**Renderer and supporting behavior**

- [`Renderer.tsx`](../src/ui/modes/reading/Renderer.tsx), `renderCritic`: comment markers expose
  the raw comment content, including a tag, without classifying the author. A highlight is visible
  as an anchor only when a thread follows it; bare highlights render as plain text. Insertions,
  deletions, and substitutions are suggestions regardless of who wrote them, and their model has
  no author field. This is a presentation distinction by mark kind, not a directional gate.
- [`CommentRail.tsx`](../src/ui/review/CommentRail.tsx): both live and exiting cards render every
  comment's tag and body with the same treatment. `submitReply` appends a consecutive comment
  signed with the current user's tag. `resolveThread` removes all comments plus the anchor, with
  no distinction between an unanswered question, an agent answer, and a human reply. Thus agent
  replies already appear, but there is no agent styling, ownership check, or answered state.
- [`SessionView.tsx`](../src/ui/app/SessionView.tsx): `activeCardSpan` maps any thread member to
  its card, gutter ticks represent whole threads, and print footnotes include every comment's tag
  and body. None filters agent authors. The rail is hidden in the translated view;
  [`TranslatedView.tsx`](../src/ui/translate/TranslatedView.tsx) is read-only and directs review
  back to the original, independently of author.
- [`scanner.ts`](../src/shared/critic/scanner.ts), `parseAuthor`, `group`, and `reviewCounts`:
  tags are strings, consecutive marks form threads, and every comment counts toward the hand-back
  summary. An agent answer would therefore increase "comments" just like a human question.
  [`critic-scanner.test.ts`](../tests/critic-scanner.test.ts) already checks an anchored human
  comment followed by an `@agent` reply. There is no parser change required merely to admit one.
- [`handback.ts`](../src/server/handback.ts) counts the grouped marks without author filtering;
  [`feedback.ts`](../src/server/feedback.ts) preserves comment text on save. Neither enforces the
  prose prohibition or distinguishes resolved discussion from outstanding feedback.

Outside the requested shipped surfaces, [`README.md`](../README.md)'s review workflow and
[`feature-test.md`](../feature-test.md)'s demonstration also describe one-direction feedback.
They would need reconciliation if the squad rules otherwise.

The ruling still needed is whether an answered comment stays beside an agent's harness-tagged reply,
when a thread is removed, and whether answers need any distinct display or summary treatment. The
squad's convention supplies a candidate policy; this inventory does not adopt it.

## Trial notes

Add dated observations from squad use here; move anything that becomes a ruling or a direction entry
out as it settles.

- 2026-10-10 — `npx mastermind-md open --no-translate <file>` is the working invocation; a bare path
  is parsed as an unknown command. The reading surface itself reads well.
