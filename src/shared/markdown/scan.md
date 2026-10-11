# Markdown review boundaries

`scanMarkdown` is the entry point for active document marks. It uses the existing remark parser's
source positions: both delimiters must fit inside one paragraph, heading, or table cell. Code,
HTML, and frontmatter remain opaque. List and blockquote continuation lines are allowed when they
belong to the same paragraph; crossing list items, headings, or cells is unsupported.

Unsupported spans remain literal source and do not enter review actions, counts, source highlighting,
or translation's annotation removal. The reading transform and document analysis use the same span
list. Accepting or rejecting valid neighboring suggestions leaves unsupported source bytes intact.
Split a proposed edit into separate marks for each text block to make it reviewable.

The raw scanner in `../critic/scanner.ts` only recognizes delimiter syntax. Use it for isolated
CriticMarkup strings, such as archived thread payloads, rather than active Markdown documents.

`tests/critic-block-boundaries.test.ts` covers the cross-list failure pattern, all mark kinds,
headings, table cells, LF/CRLF, valid continuation lines, and neighboring edit splices. These cases
characterize the supported boundary; they do not reconstruct the unavailable original trial file.
