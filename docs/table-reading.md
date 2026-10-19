---
status: living
updated: 2026-10-19
exit: Choose and ship a wide-table presentation, then graduate its contract beside the renderer.
---

# Reading wide tables

Horizontal scrolling recovers hidden content but still makes long prose cells difficult to compare.
The reading width is appropriate for paragraphs, not necessarily for a table with several columns.

## Recommended first step: wide tables within the page

Let a wide table use available page margins while paragraphs retain their preferred reading width.
Keep a safe inset from the outline and window edge. An open comment rail still owns its space;
tables must not cover it or force it away. Smaller tables should not expand unnecessarily.

Wrap long identifiers at safe visual boundaries without changing the source or shrinking the type.
Keep horizontal scrolling as the fallback when the available width is insufficient. Add subtle
edge shadows only on sides with hidden content, and keep a usable scrollbar. The shadows explain
continuation; they do not replace the extra reading space.

Carbon's [table guidance][carbon] recommends giving dense tables more page width. Applying that to
Markdown is a design proposal here, not a requirement to copy an application data grid.

## Alternative: a dedicated table view

An explicit Expand table action could give a table the full content area, with a clear return to
the same place in the document. This offers more space when comments or a narrow prose column
constrain the page, at the cost of an extra interaction and temporarily losing surrounding prose.

Keep header labels visible within this view. Preserve semantic table cells and exact source
mapping; commenting must still target the original document. Avoid duplicating the live table DOM
with competing source anchors. This alternative needs a design decision before implementation.

## Boundaries and validation

Do not automatically collapse columns, transpose tables into cards, infer a special first column,
or shrink text to fit. Those choices can obscure comparisons or assign meaning not present in the
Markdown. Compare layouts using narrow windows, long prose cells, long code identifiers, and open
comments. Verify both Chinese and English text, selection, search, and table comments before ship.

[carbon]: https://v10.carbondesignsystem.com/components/data-table/usage/
