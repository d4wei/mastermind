# Resolved discussion records

`review-archive.ts` moves a completed discussion into a versioned HTML comment at the document tail.
Each record is independent:

```html
<!-- mastermind:resolved-thread v1
{
  "context": "quoted surrounding text",
  "thread": "the original thread with delimiters encoded as JSON Unicode escapes"
}
-->
```

`context` is the highlight's exact inner source, or for a point comment the source of the text
block containing it (paragraph, heading, or table cell, as `textBlockRanges` finds them) with the
discussion removed. `thread` is the exact original source from the anchor through
the last adjacent comment. Original author tags and discussion bytes remain in `thread`; the parser
derives an ordered author list for callers rather than duplicating it in the stored record.

JSON parsing supplies reversible decoding. Within JSON strings, braces, angle brackets, and hyphens
use Unicode escapes. Structural JSON braces remain literal. This prevents literal CriticMarkup
openers/closers and HTML comment delimiters from escaping the archive or reaching reference scanners
that do not exclude HTML comments. The document's Markdown parser sees an HTML block, so reading
hides it and translation excludes it. The encoding is for compatibility, not privacy.

`parseResolvedThreads` returns decoded entries and source ranges. Unsupported versions, malformed
JSON, invalid fields, and unsafe literal delimiters produce diagnostics with raw ranges. Parsing
does not rewrite anything. Later resolution appends independent records while preserving existing
bytes; an unterminated archive blocks appending because a new record would become part of it.
Code examples are not archive records. Adjacent comments are parsed as independent records even when
a manually edited archive omits blank separation.

`resolveThreadEdits` and `deleteCommentEdits` validate a captured thread against freshly scanned
source before returning exact splices. Resolution checks the proposed result with the Markdown
parser and throws a descriptive error if the archive would fall inside an unterminated code or HTML
block; callers surface that failure before applying any edits. Stale or already-removed threads
return no edits. Resolve removes comment spans and only the highlight anchor's delimiters;
suggestion marks remain untouched. Delete removes one selected comment and unwraps the highlight
only when its last comment disappears. Deletion creates no historical record. Undo belongs to the
document store, which retains the source before applying these edits. Existing source bytes remain
unchanged outside the selected spans and the tail insertion; new archive lines follow the source's
dominant line endings and final-newline convention.

Offsets and parsed comment text identify an active thread for immediate actions, not a durable ID.
If an unrelated edit recreates an indistinguishable thread at identical offsets, it is the current
thread; no cross-process identity is inferred. Saved-file conflicts remain the document writer's
responsibility. Resolved records are historical context, not outstanding review or agent
instructions; receiving agents may clean them up when appropriate.
