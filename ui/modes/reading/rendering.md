# Reading presentation

`Renderer.tsx` renders the parsed Markdown tree while retaining source offsets for review edits.
Each table sits inside a labeled, keyboard-focusable horizontal scroll region. The table retains
its header/cell semantics and source positions; overflow does not widen the reading column.

## Table viewports

`TableViewport` sizes one table against the window's available content width and freezes that
geometry across expansion and collapse. Paragraphs wrap within that width; unbreakable content can
still exceed it. Window size and typography changes recalculate the geometry. Small tables keep
their natural width and have no expansion control.

Normally, the clipping viewport matches the prose column. Edge fades indicate hidden content and
disappear at the corresponding scroll boundary. A quiet, labeled icon above the upper-right corner
expands the viewport to the window's content bounds. Only its horizontal position and width animate;
cell widths, line wrapping, row heights, and surrounding prose positions stay unchanged. The frame
reserves scrollbar height in both states, but no scrollbar appears when the content fits.

`TableExpansionProvider` coordinates a single expanded table. Outline, comment rail, and mark gutter
fade away and become inert during expansion; their layout reservations remain. Collapse or Escape
restores the normal horizontal offset and surrounding controls. Escape returns focus to the table
button without intercepting an active composer. Reduced motion switches geometry immediately;
resizing settles an in-progress transition at the new bounds.

Opening a discussion or applying a review edit returns to the normal layout. Selection retains the
same source anchors while expanded, and its composer follows horizontal scrolling. Find reveals
matches within clipped columns. Source changes, mode changes, and document removal release any
expansion. Print rendering removes viewport clipping and expansion controls.

Fenced code passes its explicit language to `highlight.ts` only when a Code color scheme is enabled.
The tokenizer recognizes aliases for its supported language families; it does not detect languages
from code content. Missing or unsupported labels remain plain. The current tokenizer approximates
syntax rather than using complete language grammars; YAML is currently unsupported. Token text
concatenates to the original block text, including line endings. Coloring never changes the source.
