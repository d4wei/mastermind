# Mapping review selections to source

`selection.ts` maps the rendered document's DOM ranges to exact source slices. It uses the
renderer's `data-ps`/`data-pe` offsets when text matches, otherwise an unambiguous substring within
the containing block. Unmappable blocks are skipped. Multi-block selections split at block and
existing-mark boundaries; comments anchor to the first remaining range.

A complete inline-code selection includes the source backticks in its range. CriticMarkup wraps
that range, so the anchor and comment delimiters stay outside code. Rendered code may normalize
padding or line breaks; the source range retains those original bytes. Partial code selections
are not markable, since inserting delimiters inside code makes them literal and expanding a partial
selection would silently change the scope of a suggested deletion. Select the whole code span or
use its paragraph's block action. Fenced code is not an inline review target.

Both selection and block actions check Markdown's opaque source ranges before emitting a mark;
new delimiters cannot fall inside code, HTML, or frontmatter. Code examples containing literal
CriticMarkup continue to render as code. Existing malformed/literal text is not automatically
rewritten.

Block actions derive a leaf block's content from its inline descendants, preserving formatting
syntax and excluding structural prefixes and nested blocks. They split around existing marks and
omit whitespace-only gaps. `tests/inline-code-selection.test.tsx` exercises the real renderer,
selection mapping, comment/deletion edits, reparsing, and exact accept/reject splices together.
