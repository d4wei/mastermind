# Markdown review boundaries

`scanMarkdown` is the entry point for active document marks. It uses the existing remark parser's
source positions and scans each paragraph, heading, and table cell (`textBlockRanges`) as its own
window: both delimiters must fit inside one text block, and an unterminated opener never reaches
past its block to hide a later mark. `excludedRanges` is the single authority for opaque source:
code, HTML, frontmatter, images and image references, and link destinations. An autolink's
destination is its own visible text, so marks there stay active; `criticTransform` restores the
link's URL from the source with the delimiters literal. List and blockquote continuation lines are
allowed when they belong to the same paragraph; crossing list items, headings, or cells is
unsupported.

Unsupported spans remain literal source and do not enter review actions, counts, source highlighting,
or translation's annotation removal. The reading transform and document analysis use the same span
list, produced once for each reading analysis and carried through the current file's parse and
transform. `scanMarkdownTree` accepts the plain tree of the exact source being scanned; the masked
reading tree is unsuitable for exclusions or review boundaries. Accepting or rejecting valid neighboring suggestions leaves unsupported source bytes intact.
Split a proposed edit into separate marks for each text block to make it reviewable.

The raw scanner in `../critic/scanner.ts` only recognizes delimiter syntax within the windows it is
given (the whole string by default); it has no notion of blank lines or blocks. Use it directly for
isolated single-run CriticMarkup strings, such as archived thread payloads, rather than active
Markdown documents.

`tests/critic-block-boundaries.test.ts` covers the cross-list failure pattern, all mark kinds,
headings, table cells, LF/CRLF, valid continuation lines, unterminated openers before a valid mark,
and neighboring edit splices.
