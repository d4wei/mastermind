# Mapping review selections to source

`selection.ts` maps the rendered document's DOM ranges to exact source slices. It uses the
renderer's `data-ps`/`data-pe` offsets when text matches. A selection within a positioned text leaf
can also map through removed list/blockquote continuation prefixes and normalized line endings: its DOM
text must match the parsed text node, and each rendered line must match its source line after only
those prefixes are removed. This retains exact source bytes across lines and distinguishes repeated
characters by position. It does not strip arbitrary whitespace or decode entities to guess offsets.
When escapes or entities make a leaf's rendered length differ from its source, the selected text
maps only if it occurs exactly once in
both the rendered and the source text of its window: the narrowest positioned element holding the
selection, bounded by the nearest positioned element or rendered review mark on each side. Text
that is not unique within that window is refused, even when it is unique elsewhere in the block.
A source match that overlaps a character reference or backslash escape is refused too: it renders
as different characters, so it is another occurrence, and delimiters inside it would split it.
Comments anchor to the first mapped range.

A selection splits first at block boundaries, then within each block at rendered review marks
(`.critic[data-span-index]`). The pieces outside the marks map independently; whitespace-only and
unmappable pieces are skipped while the rest stay markable, and a selection wholly inside a mark
yields nothing. A mapped range that still overlaps a review span, such as a mark that rendered
literally, is dropped. Unanchored highlights render as plain text without a
`.critic[data-span-index]` element, so a piece across one overlaps its span and maps nothing. A
container block such as a list item with a nested list contributes only its own text before the
first nested block; the nested blocks map as blocks of their own, including when the selection's
common ancestor is the container itself.

Frontmatter properties or their literal fallback form one opaque block. Selections beginning
there can continue into body text, but only the body portion receives review ranges. Nested raw
source does not displace the metadata wrapper when enumerating blocks across a selection.

Selections that cross complete emphasis, strong, strikethrough, link, or inline-code wrappers retain
those wrappers' exact Markdown source, rather than comparing their syntax with plain rendered text.
The DOM positions must match nodes from the existing Markdown parser, and each complete wrapper's
rendered text must match its parsed text. Outside those wrappers, selected text maps to exact source
slices and the slices must be contiguous: unaccounted source gaps are refused. Reference links and
other unsupported rendered structures do not become guessed source ranges. A mapping operation
never parses: it takes the plain tree from the current source's analysis for opaque ranges and
lazily indexes that tree for formatted blocks and normalized text leaves; the index is discarded
after the operation.

A selection confined to one text leaf within formatting keeps its exact text range, including the
windowed unique-substring fallback when rendered entities change that leaf's length.
A selection that crosses only part of a formatting wrapper is refused, so a mark cannot strand an
opening or closing delimiter. Splitting those partial selections into several ranges is deferred.
Text the renderer splits around a review mark keeps exact offsets when its parsed text node's value
spans exactly its source; a node whose entities or escapes decode, or whose container prefixes are
dropped, leaves its pieces unpositioned, and they fall back to the unique-substring rule, which a
piece crossing a formatting wrapper cannot satisfy.

A complete inline-code selection includes the source backticks in its range. CriticMarkup wraps
that range, so the anchor and comment delimiters stay outside code. Rendered code may normalize
padding or line breaks; the source range retains those original bytes. Partial code selections
are not markable, since inserting delimiters inside code makes them literal and expanding a partial
selection would silently change the scope of a suggested deletion. Select the whole code span.
Fenced code is not an inline review target.

Selection actions check Markdown's opaque source ranges before emitting a mark;
new delimiters cannot fall inside code, HTML, or frontmatter. Code examples containing literal
CriticMarkup continue to render as code. Existing malformed/literal text is not automatically
rewritten.

`tests/inline-code-selection.test.tsx` exercises the real renderer, selection mapping,
comment/deletion edits, reparsing, and exact accept/reject splices together.

`tests/wrapped-selection.test.tsx` checks repeated characters and cross-line selections in lists
and blockquotes, including retained line endings and exact review splices.

`tests/formatted-selection.test.tsx` checks complete and partial formatted selections against the
real renderer, reparsing, and exact deletion acceptance/rejection, including retained CRLF.

The selection toolbar debounces browser selection changes until a composer owns its captured
anchor. Entering or dismissing a composer cancels pending checks; delayed checks also verify that
no composer has taken ownership. Actions flush a pending valid selection so rapid reselection uses
the latest passage. A toolbar retained only for its exit animation cannot start a new composer.
Escape dismisses pending work as well as the visible controls. A shown toolbar re-reads its surviving
selection when the source changes, since no selection event follows. Draft text remains intact across
focus changes, scrolling, and source updates; submission still requires the captured source. A
comment, change, or reply cannot be submitted unless the whole edited source reparses with exactly
the intended marks starting inside each insert, every existing mark at its shifted offsets with
unchanged extents, and no other mark. A new comment must also add exactly one discussion, so it
cannot join a comment already beside the selection. Composers show the verdict for their deferred
text, reusing it until the source, selection, or text changes, and name a body line that opens block
syntax as the reason; submission verifies the final text.
