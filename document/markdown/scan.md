# Markdown review boundaries

`scanMarkdown` is the entry point for active document marks. It uses the existing remark parser's
source positions and scans each paragraph, heading, and table cell (`textBlockRanges`) as its own
window: both delimiters must fit inside one text block, and an unterminated opener never reaches
past its block to hide a later mark. `excludedRanges` is the single authority for opaque source:
code, HTML, frontmatter, images and image references, and link destinations. An autolink's
destination is its own visible text, so marks there stay active; `criticTransform` restores the
link's URL from the source with the delimiters literal, searching the link's own source range or,
for a GFM literal autolink the parser builds without a position, its nearest positioned ancestor's.
When the masked URL tail is missing there, or recurs with different source, the delimiters are
stripped from the URL instead. List and blockquote continuation lines are allowed when they belong
to the same paragraph; crossing list items, headings, or cells is unsupported.

Reference-link labels are not excluded. A mark inside the label of `[x][label]`, or a shortcut
reference such as `[{++a++}]` with a matching definition, stays active, and once masked the label
no longer matches its definition, so the reading view shows the brackets as text without the link.

Unsupported spans remain literal source and do not enter review actions, counts, source
highlighting, or translation's annotation removal. `analyzeMarkdown` parses the source plainly,
scans that tree with `scanMarkdownTree`, masks the marks, parses the masked source, records its
text provenance, and passes the same span list, mask, and provenance to `criticTransform`; a source
without marks keeps its plain tree, with its provenance, as the reading tree. `scanMarkdownTree` accepts the plain tree of the exact source being scanned; the
masked reading tree is unsuitable for exclusions or review boundaries. Accepting or rejecting valid
neighboring suggestions leaves unsupported source bytes intact. Split a proposed edit into separate
marks for each text block to make it reviewable.

## Text provenance

`provenance.ts` maps each character of a reading-tree text node to the source it came from. The
parser builds a text value by appending literal data, line endings, and decoded escapes and
references, and drops container prefixes after a line ending and whitespace before one;
`alignText` replays exactly those steps from the node's position and value, decoding each candidate
escape or reference with micromark's own `decodeString`, and records nothing unless both are
consumed completely. A run is literal, matching its source character for character, or atomic: one
decoded escape or reference, never split. Runs live in the analysis's `TextProvenance`, off the
tree, so reading trees stay plain mdast. `criticTransform` slices them for each text piece it splits
around a mark and positions the piece at the extent they span; text the parser builds without a
position, such as some GFM literal autolinks, has no provenance.

`structure.ts` derives a tree's reading shape: node types, rendered attributes, and text, without
positions. Review-edit verification compares shapes before and after an edit to check that marks
leave the Markdown around them rendering the same.

The raw scanner in `../critic/scanner.ts` only recognizes delimiter syntax within the windows it is
given (the whole string by default); it has no notion of blank lines or blocks. Use it directly for
isolated single-run CriticMarkup strings, such as archived thread payloads, rather than active
Markdown documents.

`tests/text-provenance.test.ts` checks alignment against parsed Markdown, including generated
documents, and the decoder behavior it relies on. `tests/critic-block-boundaries.test.ts` covers the cross-list failure pattern, all mark kinds,
headings, table cells, LF/CRLF, valid continuation lines, unterminated openers before a valid mark,
and neighboring edit splices.
