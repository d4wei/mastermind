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

- **"The file on disk is the protocol."** A plan and its CriticMarkup feedback travel together.
  Upstream also appends a hand-back summary. A teammate or agent can participate with a text editor;
  the review does not depend on an account, a service, or a second store of discussion state.
- **"Reviewer-grade reading experience" and "the document column is sacred."** Typography,
  reading measure, and the margin rail serve long sessions of thinking about a document. Keep
  the quiet reading surface, keyboard shortcuts, and restrained chrome; a three-person audience
  does not call for a dashboard or another toolbar.
- **"Swiss International, in service of reading."** Keep flat surfaces, hairline rules, generous
  spacing, and theme tokens. Accent belongs to controls; review marks carry semantic color in the
  document. The optional code-color preference remains an explicit exception. User-selectable
  fonts and themes support different readers without changing the document's content.
- **"Marks are the data."** Review actions hang off source spans, and accepting a mark is an exact
  splice. Keep byte-preserving source edits without a Markdown serializer rewriting unrelated text.
  Upstream's setup prose also promises a revision diff, but the current code has removed rounds and
  snapshots; that promise is not a shipped capability. The squad now permits author-tagged replies
  from people and agents.
- **"Local, fast, silent" and the hand-back loop as "the product's spine."** Upstream's per-file
  session, summary, and stdout signal make completion explicit. Keep the underlying principle that
  agents consume files without driving the UI. The squad's later ruling in `DECISIONS.md` replaces
  explicit hand-back with continuous saving; the upstream mechanism no longer binds the fork.

The historical behaviors plan at upstream `3687c91` adds integration rationale worth retaining:

- **"CLI does everything deterministic."** Skills ask the person, supply language judgment, and
  call shared primitives. Keep the thin harness adapters and shared browser-safe registries so
  different coding agents do not grow divergent implementations of configuration or cache keys.
- **"The agent is the translator."** Offline cache preparation avoids asking one process to drive
  a review and answer its own live translation requests. Hash-keyed blocks reuse unchanged work;
  shared segmentation and target-language selection keep CLI-written entries compatible with the
  browser. Retain agent preparation and optional translated reading. The later squad ruling replaces
  cached-block reuse with fresh snapshots and makes opening independent of translation.
- **One preferred/secondary language pair.** Setup and the reading toggle share `langPair`, avoiding
  competing preferences. Retain consistent language configuration and optional translated reading;
  the later squad ruling replaces the pair's semantics with repo and optional comfort languages.
- **Portable, reversible provisioning.** Upstream's shared installer and marked global blocks make
  installation reversible across harnesses. Retain portability and clear removal guidance; the
  later squad ruling moves installation ownership to the harness through skill/package guidance.

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

## Heavy track — rulings and remaining candidates

[`DECISIONS.md`](../DECISIONS.md) records settled product directions. The
[`architecture review`](architecture-review.md) owns the wishlist, proposed ablation sequence, and
remaining implementation choices and execution status. Implementation follows the approved plan.

The following original questions still need rulings before implementation:

- Package, CLI, and config-directory rename.
- Repository settings: storage, discovery, and precedence for repo language; whether the review
  convention also needs a shared setting. Comfort language and author tags remain personal.

The browser-container bet has graduated to the desktop-wrapper ruling. GUI onboarding, continuous
saving without explicit hand-back, agent discretion over review-file selection, and cross-platform
viability are also settled there. See the architecture review for execution status.

### Agent-authored comments: current assumptions and existing support

Inspection on 2026-10-10, after the light fixes. The subsequent ruling in `DECISIONS.md` permits
author-tagged agent replies. This dated inventory records the original conflicts, not current
behavior. The [public protocol][protocol] replaces the conflicting instructions. The renderer has
never enforced a human-only author role.

[protocol]: ../.claude/skills/mastermind/reference/review-protocol.md

**Instruction surfaces**

- `AGENT_SETUP.md` (now [agent setup](../assets/agent/README.md)), "Plan reviews via Mastermind":
  the pasteable block calls marks the user's feedback, requires direct revision and removal of
  resolved marks, explicitly
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
the `feature-test.md` demonstration also describe one-direction feedback. The example now lives in
[manual interactions](../tests/manual/review-interactions.md).
The public guidance now follows the squad ruling.

The later ruling and public protocol govern answered threads and their retention. This inventory
remains evidence of the original design, not an additional policy source.

## Trial notes

Add dated observations from squad use here; move anything that becomes a ruling or a direction entry
out as it settles.

- 2026-10-10 — `npx mastermind-md open --no-translate <file>` is the working invocation; a bare path
  is parsed as an unknown command. The reading surface itself reads well.

### 2026-10-10 — UI observations from document review

The user supplied five screenshots and two further observations. These are intake findings, not
implemented fixes. Screenshots 2–3 came from a document that has since been processed away; its
source cannot be inspected. The code checks below describe the current checkout at `0d83478`.

These observations describe the initial trial. Subsequent implementation is recorded in the
[architecture review](architecture-review.md); retain the evidence below as the original diagnosis,
not a current bug-status list.

1. **Selection is invisible in the comment composer (screenshot 1).** The user reports selected
   text has no visible highlight. `app.css` supplies one global selection color, while the composer
   uses inverted surface/text tokens. In the light themes, that selection color derives from dark
   text and is a plausible poor match for the dark composer. Reproduce in the affected theme before
   calling this the confirmed cause; check focused and unfocused selection across themes. This
   concerns comment inputs, not the intentional suppression of settings-label selection.
2. **Author formatting differs (screenshot 2).** `@Da Wei:` appears in the body; `@claude` gets the
   author label. `scanner.ts`'s `parseAuthor` rejects whitespace in an author token. A direct check
   returns no author for `@Da Wei: A note` and `claude` for `@claude: A note`. `CommentRail.tsx`
   only emits the label when an author was parsed. This explains the pictured distinction regardless
   of the selected anchor "In". Decide whether names with spaces are supported or normalized; align
   configuration, external markup, and rendering without silently changing existing signatures.
3. **Insertion delimiters appear literally (screenshot 3).** The pictured insertion appears to span
   two list items. A synthetic source with an opener at the end of one item and a closer in the next
   produces one scanner insertion span but zero `criticInsert` AST nodes; both delimiters become
   text. `critic-mdast.ts` pairs wrappers within each parent and restores unmatched wrappers as
   literals. The original source is unavailable, so this is a related reproduction, not an exact
   diagnosis of the screenshot. The review convention forbids marks spanning blocks; decide how
   imported invalid placements are explained, and check same-block valid marks separately.
4. **Soft wrapping becomes visible line breaks (screenshot 4).** `.rail-body` uses
   `white-space: pre-wrap`, so source newlines survive in the card. This accounts for a hard-wrapped
   comment breaking after "derived". Proposed display behavior: treat ordinary source newlines as
   prose spacing while preserving stored bytes. Explicitly multiline content needs a defined rule;
   do not repair this by rewriting the comment on disk.
5. **The app toolbar overlaps Codex's composer (screenshot 5).** Both occupy the bottom region.
   The app toolbar is fixed near the viewport bottom. A standalone desktop window removes this
   particular host overlay, but the browser development view still needs usable controls. Compare
   an ordinary browser and the embedded view; prefer a layout that avoids the collision over a
   hardcoded Codex-specific offset. The screenshot does not identify the host's inset contract.
6. **There is no per-comment Delete action.** Current `resolveThread` removes every comment in the
   thread and unwraps its highlight, preserving the anchored prose. Autosave writes that removal;
   there is no durable resolved-thread archive. Buffer undo and any existing Git history are not
   such an archive. The Delete/Resolve distinction and retention policy need a product ruling; see
   [the architecture discussion](architecture-review.md#comment-lifecycle).
7. **External-change notices are easy to miss when scrolled.** The banner appears before the
   document and `.banner` has no sticky/fixed positioning. The requested outcome is a persistent,
   viewport-visible notice with actions while attention is required. Design it with the dirty-buffer
   conflict flow, without covering the selection, comment composer, or app toolbar. Clean-buffer
   automatic reload may remove some notices, but conflicts and deletion still require visibility.

The parser/rendering mismatch belongs in the renderer comparison's regression cases. Selection,
author labels, and comment wrapping survive a shell change and need their own checks. The host
overlay collision is partly container-specific. Thread lifecycle and external-change notices feed
the architecture plan before implementation; they are not merely styling tasks.
