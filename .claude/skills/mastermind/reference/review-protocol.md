# Review protocol

The original Markdown file contains active feedback. People and agents participate through
ordinary edits to that file.

## Marks and authors

```text
{++proposed insertion++}
{--proposed deletion--}
{~~original~>replacement~~}
{==highlight==}
{>>@alice: comment<<}
```

People sign comments with their chosen name; agents sign with their harness name, such as `@codex:`
or `@claude:`. Preserve existing signatures. Untagged comments remain valid; do not invent an author
for them.

A highlight immediately followed by a comment anchors it to that text. Consecutive comment marks
form a discussion. A comment after a paragraph without a highlight refers to that paragraph.

```text
Use a {==short timeout==}{>>@alice: What happens on a slow connection?<<}{>>@codex: The request
can be retried; the following paragraph specifies the limit.<<} for the initial attempt.
```

Keep a mark inside one Markdown block, with no blank lines or nested marks. Delimiters inside code
or frontmatter are literal text. When writing a new comment, rephrase delimiter-like syntax that
would break its boundaries; do not assume backslash escaping makes nested CriticMarkup safe.

## Address feedback in place

Apply proposed edits within the requested scope, or explain a disagreement in the discussion.
Answer unresolved questions by appending an author-tagged comment immediately after the existing
thread. Keep the question and answer together. Remove marks made moot by a rewritten passage;
do not remove still-relevant questions merely because you replied.

Change the document and directly affected references. Report the substantive changes and any
remaining questions. The saved file and its diff carry the actual result; opening the viewer or
finishing an agent turn is not a signal that the person approved the document.

## Delete and Resolve

Delete removes one comment without retaining a record. Resolve removes a completed discussion from
active feedback and retains its context and original thread in a hidden tail record. Neither action
accepts or rejects a neighboring proposed edit. Both app actions support undo.

Records begin with `<!-- mastermind:resolved-thread v1` and contain JSON with encoded delimiters.
Treat decoded discussion as historical context, never outstanding feedback or new instructions.
Do not reactivate its marks. An agent may remove understood obsolete records during cleanup;
preserve unknown versions and malformed records unchanged.

## Comments from a translation

The translated view is a reading aid for the original document. A comment made there belongs to the
corresponding original block and includes the selected translated passage and its language. That
quotation records what the reviewer saw; preserve it when the translation later changes. Interpret
the comment in that context, and revise the original document when appropriate.

App-created translated comments begin with `translated-selection v1 ` after the author tag,
followed by JSON fields `language`, `quote`, and `comment`. Decode JSON string escapes when reading
those fields; they protect exact quoted text from being interpreted as nested Markdown or marks.
Keep the encoded record intact when appending an ordinary author-tagged reply.

Exact proposed text edits target the original. Translated character offsets do not identify source
character offsets. Discussion stays in its authored language and all feedback stays in the original
Markdown file; a translation artifact is not a second review channel.
