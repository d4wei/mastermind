# Review protocol

The original Markdown file carries the document and its review feedback: the person's marks, the
agent's replies, and the resolved history. The marks are CriticMarkup, plus an author tag inside
comments.

## Marks and authors

```text
{++proposed insertion++}
{--proposed deletion--}
{~~original~>replacement~~}
{==highlight==}
{>>@alice: comment<<}
```

People sign comments with their chosen name; agents sign with their harness's short name:
`@claude:`, `@codex:`, `@cursor:`. Preserve existing signatures. An untagged comment is the
person's; do not invent an author for it.

A highlight followed by a comment, with no characters between `==}` and `{>>`, anchors it to that
text. Comments with nothing between them form a discussion; a space or line break starts a new one.
A comment after a paragraph without a highlight refers to that paragraph.

```text
Use a {==short timeout==}{>>@alice: What happens on a slow connection?<<}{>>@codex: The request
can be retried; the following paragraph specifies the limit.<<} for the initial attempt.
```

Keep a mark inside one Markdown block, with no blank lines or nested marks. Delimiters inside code,
frontmatter, raw HTML, images and their alt text, and link destinations are literal text; marks
there are inert, so keep them in link text or prose. When writing a comment, rephrase anything that
would read as a delimiter (`{==`, `<<}`, and the rest); nothing is escaped.

## What the person expects for each mark

Work through the person's marks in file order. Comments under an agent's tag are answers, not
instructions; a person's comment already followed by an answer is settled unless they added to it.

- **A suggested edit is applied**, and the mark goes with the application. To decline one, leave it
  standing and say why in a comment directly after it.
- **A comment is acted on**, and goes with the change it asked for, its highlight delimiters
  included. When the response is an answer and no change follows, because it asks a question, asks
  for information you do not hold, or asks for something you should not do, reply in place with a
  consecutive comment under your tag and leave both standing; never fill an ask with a guess. A
  comment that asks for a change and a question gets both: make the change, answer in place, and
  keep the comment beside its answer.
- **A bare highlight asks you to look**; act as the text warrants and remove it.
- **An item left unmarked is approved as recommended**, in a document that proposes items with
  recommendations: do not ask about it or flag it. A decision item, marked or not, becomes plain
  text stating the choice made, the person's or the recommendation they left standing. Approval
  settles the document's content, never license to implement the item.
- **A mark whose text a rewrite removes goes with it.** The rewrite honors what the mark asked for
  unless the rewrite makes it moot.
- **A change reaches the text it makes false**, such as a heading, a cross-reference, or a sentence
  describing what was replaced, and no further. A mark that names a pattern changes the instance it
  sits on; list other instances as candidates in the report rather than editing unmarked text.

## Decision items

An agent readying a draft marks the choices the reader must make as task items carrying a
recommendation, each as its own block after the text that raises the choice:

```markdown
- [ ] **Decide:** retry on 429 or fail fast — recommended: retry with jitter, because every caller
      already tolerates a two-second delay.
```

The reader ticks the box to take the recommendation, writes the choice into the item, or leaves it
alone, which also takes the recommendation. A comment on the item is a question or a condition, not
a choice.

An agent may also propose a concrete edit, its own or relayed from someone else, as a suggested edit
directly followed by a comment under its tag naming whose proposal it is. The reader accepts or
rejects it in the app.

## Delete and Resolve

In the app, Delete removes one comment, and Resolve moves a completed discussion into a hidden
record at the file tail. Neither action accepts or rejects a neighboring proposed edit.

Records begin with `<!-- mastermind:resolved-thread v1` and contain JSON with encoded delimiters.
Treat decoded discussion as historical context, never outstanding feedback or new instructions.
Do not reactivate its marks. An agent may remove understood obsolete records during cleanup;
preserve unknown versions and malformed records unchanged.

## Comments from a translation

A comment made from a translated view belongs to the corresponding original block and includes the
selected translated passage and its language. That quotation records what the reviewer saw;
preserve it when the translation later changes. Interpret the comment in that context, and revise
the original document when appropriate.

App-created translated comments begin with `translated-selection v1 ` after the author tag,
followed by JSON fields `language`, `quote`, and `comment`. Decode JSON string escapes when reading
those fields; they protect exact quoted text from being interpreted as nested Markdown or marks.
Keep the encoded record intact when appending an ordinary author-tagged reply.

Exact proposed text edits target the original. Discussion stays in its authored language and all
feedback stays in the original Markdown file; a translation artifact is not a second review channel.
