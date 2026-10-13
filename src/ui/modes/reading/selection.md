# Mapping review selections to source

`selection.ts` maps the rendered document's DOM ranges to exact source slices. It uses the
renderer's `data-ps`/`data-pe` offsets when text matches, otherwise an unambiguous substring within
the containing block. Unmappable blocks are skipped. Multi-block selections split at block and
existing-mark boundaries; comments anchor to the first remaining range.

Frontmatter properties and their raw YAML disclosure form one opaque block. Selections beginning
there can continue into body text, but only the body portion receives review ranges. Nested raw
source does not displace the metadata wrapper when enumerating blocks across a selection.

Selections that cross complete emphasis, strong, strikethrough, link, or inline-code wrappers retain
those wrappers' exact Markdown source, rather than comparing their syntax with plain rendered text.
The DOM positions must match nodes from the existing Markdown parser, and each complete wrapper's
rendered text must match its parsed text. Outside those wrappers, selected text maps to exact source
slices and the slices must be contiguous: unaccounted source gaps are refused. Reference links and
other unsupported rendered structures do not become guessed source ranges. Each mapping operation
parses the source once for opaque ranges and lazily indexes that same tree for formatted blocks;
the index is discarded after the operation.

A selection confined to one text leaf within formatting keeps its existing exact text range,
including the unambiguous substring fallback when rendered entities change that leaf's length.
A selection that crosses only part of a formatting wrapper is refused, so a mark cannot strand an
opening or closing delimiter. Splitting those partial selections into several ranges is deferred.
Formatted selections containing an existing review mark may also be refused when its hidden syntax
prevents
an exact mapping; the plain-text mark-splitting behavior remains available.

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

`tests/formatted-selection.test.tsx` checks complete and partial formatted selections against the
real renderer, reparsing, and exact deletion acceptance/rejection, including retained CRLF.
