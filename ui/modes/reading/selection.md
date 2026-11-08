# Mapping review selections to source

`selection.ts` maps a settled DOM selection in the rendered document to the exact source slices a
review mark may wrap, and accounts for every visible selected piece it leaves out. Mapping never
parses: it reads the analysis of the current source, whose reading tree carries each text node's
positional provenance (`document/markdown/provenance.ts`, described in
[review boundaries](../../../document/markdown/scan.md)), and indexes that tree once per analysis.

## Results

`mapSelection` returns one of three results. **Inactive** means nothing is selected in the
document: a collapsed or whitespace-only selection, or one outside the given root. It needs no
toolbar and no explanation. **Outdated** means a positioned element disagrees with the analysis, so
the DOM was rendered from another revision; the caller keeps its state and maps again after the
render that follows the source change. Neither is a mapping failure.

**Covered** carries the source revision the offsets index, the selected quote, the mapped segments
in source order, their rendered `fragments` (each with the segments it covers), and the excluded
segments in document order, each with a reason:

| Reason | Selected text |
| --- | --- |
| `existing-mark` | Inside an existing suggestion or discussion, or source a recognized mark owns |
| `generated-text` | Display labels absent from the Markdown, such as footnote numbers |
| `opaque-block` | Fenced or indented code, raw HTML blocks, and frontmatter |
| `partial-code` | Part of inline code or inline HTML, which is reviewed whole |
| `partial-link` | Part of an autolink or of a shortcut or collapsed reference label |
| `no-provenance` | Rendered text without exact positional provenance |

`multiple-translated-blocks` belongs to the translated view, which has its own selection path.
A covered result with excluded segments is a partial mapping, never ordinary success; one with no
segments offers no action. Whitespace-only segments and exclusions are dropped.

## The rendered DOM contract

The renderer gives each text leaf a `span[data-ps][data-pe]` holding its source extent. Inline
code, inline HTML, images, image references, and footnote references carry `data-atom` and their
extent; footnote-definition labels carry `data-generated`. Review marks render as
`.critic[data-span-index]`, and code and HTML blocks as `pre`, with frontmatter in
`.md-frontmatter`. A leaf's rendered text must equal its parsed value, up to line endings an HTML
parse normalized to LF; otherwise the result is outdated.

## Pieces

Each selected text node becomes a piece or an exclusion. A leaf maps its selected value range
through its provenance runs: a selection edge never splits a decoded character reference or
backslash escape, a start at the head of a continuation line falls after its container prefix, and
an end there falls before it. Repeated or decoded text maps by position, never by searching for
equal text. A complete atom maps to its whole extent, so inline-code delimiters stay outside code;
a partial atom is excluded. An image the selection crosses is covered whole.

## Segments

Pieces join into segments only within one text block (paragraph, heading, or table cell) and never
across excluded text, so each mark fits the scanner's block windows. Within a run, planning splits
pieces only at parser-identified boundaries:

- A wrapper (strong, emphasis, strikethrough, link, or reference link) wholly inside a segment
  keeps its exact syntax. Pieces that run from one edge of a wrapper's content past its other edge
  select it completely, so the segment takes that edge's syntax.
- A wrapper the pieces only partly cover splits them at its content boundary, so marks wrap the
  selected text on each side and the wrapper's delimiters stay intact.
- An existing mark between pieces splits them, so marks never nest.
- Pieces inside locked content that a segment does not wrap whole are excluded as `partial-link`.

A guard drops any segment whose delimiters would land inside source the plain parse treats as
opaque, which can only happen if the reading tree diverged from it. Comments anchor to the first
segment.

## Verifying marks

`marks.ts` checks every comment, reply, and suggestion in the full edited source before it can be
submitted. Drafts are checked in `block` scope instead: only the top-level blocks holding the edits,
parsed on their own, so the check costs what those blocks cost. That scope cannot see reference
definitions, list items, or setext underlines outside the blocks, so it may accept what the full
check refuses; only the full check admits a mark. The edited source must reparse with exactly the intended marks starting inside each
insert and every existing mark at its shifted offsets with unchanged extents; a new comment must add
exactly one discussion. The edited reading tree must also match the original's structure
(`document/markdown/structure.ts`) with the new marks unwrapped, and with each substitution and the
source it replaces left out, since a substitution shows its old text verbatim. A refusal names
`markup` or `formatting`. The masked reading parse sees a sentinel beside a delimiter, so a mark
directly against underscore emphasis can end it there; such marks are refused as `formatting`.

## The toolbar

The selection toolbar debounces browser selection changes until a composer owns its captured
anchor. Entering or dismissing a composer cancels pending checks; delayed checks also verify that no
composer has taken ownership. Actions flush a pending selection so rapid reselection uses the
latest passage. A toolbar retained only for its exit animation cannot start a new composer. Escape
dismisses pending work as well as the visible controls. A shown toolbar re-reads its surviving
selection when the source changes, since no selection event follows, and keeps its state through an
outdated read.

A selection with segments offers Suggest change and Comment and nothing else. A partial selection
is trimmed first, so what looks selected is exactly what will be marked: `fragments` in the
coverage are the rendered extents of the segments, joined wherever no excluded text separates them.
The first fragment replaces the document selection, which holds one range in WebKit; when excluded
text separates several, the later ones are dropped with their segments, so both actions act on
exactly what is visibly selected. The selection change a trim causes is
recognized as its own echo, so it neither maps again nor notifies again. A trim waits while a
pointer button or Shift is still extending the selection; a press whose release never arrives, as
when a Ctrl+click opens the context menu, ends with that menu or with the next pointer event that
holds no button. Each trim raises one transient
notification, in the current interface language, that says whether later parts were dropped and names the distinct exclusion reasons;
it replaces the previous selection notice rather than stacking. A selection with no segments shows
no toolbar, only that notification. A comment composer for several segments, as a wrapper boundary
inside one fragment yields, says the comment attaches to the first. A comment posts on Enter, with Shift+Enter for a new
line; suggested text keeps Enter for line breaks, since it edits the document, and both submit on
Cmd/Ctrl+Enter. Composition keys stay with the IME. Draft text remains intact across focus changes,
scrolling, and source
updates; submission still requires the captured source. Composers show the block-scope verdict for
their deferred text, reusing it until the source, selection, or text changes, and name a body line
that opens block syntax, markup that would not reparse, or a mark that would change the surrounding
formatting. Submission verifies the final text in the whole document; its refusal replaces the
draft verdict until the text, selection, or source changes. A stale draft is checked against an
analysis of its own captured source, made once. Stale drafts and paused editing keep their own
messages.

The browser's selection fill covers glyphs only across, so inline code's padding and border would
break the selected band; inside the reading article that fill is transparent, and the toolbar
paints every selected state itself as a band in the selection color. Outside the article, as in the
rail and panels, the browser's selection stays. The band is a decorative layer appended to the
article, holding one rectangle per line in the article's coordinates, so scrolling moves it with
the text. It follows the document selection, measured at most once per animation frame and only
for the part inside the article; while a composer is open, which takes focus and with it the
document selection, it paints the composer's fragments until the composer closes, submits, or is
dismissed.

`selectedBoxes` takes each text node's glyph boxes clipped to the selection and the border boxes
of inline code held whole (`wholeInlineCode`: from its first character to its last), never the box
of a block held whole; `bandLines` merges the boxes on a line where they touch and gives every
rectangle on that line the line's full vertical extent. The band therefore has one height per line
and covers code chips, their padding, and spaces alike, while the chips keep their own look beneath
its translucent fill; Find's match fills show through it. `rangesInSpan` limits the measure to
blocks within a viewport height of the viewport, found by bisection, so a selection of a whole long
document stays cheap; while selected text lies beyond that reach, document scrolling re-measures
too. The layer also re-measures when the article resizes, a table reports a layout change, the
reading space changes, fonts finish loading, the window resizes, or a scroller inside the article
scrolls. It is hidden from assistive technology and takes no pointer events, and the reading DOM's
text and structure stay untouched. Review marks keep their own fill under the band: a settled
selection never holds one, since each is excluded.

## Tests

`tests/selection-matrix.test.tsx` renders each fixture with the React client, selects it forward
and backward with text and element endpoints, asserts its segments and exclusion reasons, and
round-trips a comment, a deletion, and a substitution: rejection restores the original bytes and
acceptance performs exactly the proposed change. It also covers inactivity, outdated renders, rapid
reselection, and trimming: one range replacing the document selection, the first of several parts, one
notification per trim, a trim deferred while dragging and resumed after a swallowed release, and no actions for an unmarkable selection. `tests/selection-ranges.test.ts`,
`formatted-selection.test.tsx`, `inline-code-selection.test.tsx`, and `wrapped-selection.test.tsx`
check marks, decoded text, wrappers, code, and container continuations in detail;
`tests/selection-marks.test.ts` checks edit verification in both scopes, and
`tests/composer-verdict-scope.test.tsx` checks that composers submit only past the full check.
`tests/selection-band.test.tsx` checks that the live selection and a composer's target are painted
as one merged band per line over unmarked code, that the band ignores selections outside the
article, re-measures on a table layout change, and clears with the selection or the composer, and
the band geometry, including the narrowing to the viewport.
