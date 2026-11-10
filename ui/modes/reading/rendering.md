# Reading presentation

`Renderer.tsx` renders the reading tree of one `analyzeMarkdown` result while retaining source
offsets for review edits; it reads which marks anchor discussions from that analysis's thread
cards rather than regrouping the source. Each positioned text node renders as a leaf carrying its
source extent, and inline atoms and generated labels are marked as the
[selection mapping](selection.md) DOM contract describes. A heading whose text names a callout opens a section that
runs until the next heading of equal or higher rank; `callouts.ts` holds that grouping, which the
translated view applies to source headings.
Each table sits inside a labeled, keyboard-focusable horizontal scroll region. The table retains
its header/cell semantics and source positions; overflow does not widen the reading column.

## Language

`SessionView.tsx` resolves the [document language](../../../document/markdown/language.md) once per
plain parse: the analysis's own in reading mode, the plain stand-in otherwise. A valid prepared
translation's `sourceLang` is the supplied language. The reading article carries the document's
language as `lang`, and the renderer puts `lang` on each top-level block or top-level list item
whose own language differs, looked up by its source start in `RenderCtx.blockLanguages`; the
document view renders again only when that map changes, as for any other context. With no
resolved language the article carries no `lang` and inherits the interface language. The
translated view's root carries the original's language too; a translated block carries the
prepared translation's target language when it differs, and a block shown from the original keeps
its own. The attribute changes faces only, through the `:lang()` rules the
[font contract](../../theme/fonts.md) describes.

## Table viewports

`TableViewport` sizes one table against the window's available content width and freezes that
geometry across expansion and collapse. Paragraphs wrap within that width; unbreakable content can
still exceed it. Window size, typography, and web-font loads recalculate the geometry, and so does
a change to `contentKey`, which identifies what the table renders; a key scoped to the table's own
source text leaves it unmeasured by edits elsewhere. Small tables keep their natural width and have
no expansion control.

One module-level owner measures every table: a shared resize observer and window listeners queue
tables, and a single batch runs before the frame paints, completing each read phase across all
queued tables before the writes that depend on it. A document's table count therefore does not
multiply forced layouts.

Normally, the clipping viewport matches the prose column. Edge fades indicate hidden content and
disappear at the corresponding scroll boundary. A quiet, labeled icon above the upper-right corner
expands the viewport to the table's width, capped at the window's content bounds; a table narrower
than the window centers on the prose column without crossing those bounds. Only its horizontal
position and width animate; cell widths, line wrapping, row heights, and surrounding prose positions
stay unchanged. The frame reserves scrollbar height and a gap below the table in both states, so an
overlay scrollbar never covers the last row, but no scrollbar appears when the content fits.

`TableExpansionProvider` coordinates a single expanded table. Outline, comment rail, and mark gutter
fade away and become inert during expansion; their layout reservations remain. Collapse or Escape
restores the normal horizontal offset and surrounding controls. Escape returns focus to the table
button without intercepting an active composer. Reduced motion switches geometry immediately;
resizing settles an in-progress transition at the new bounds.

Opening a discussion or applying a review edit returns to the normal layout. Selection retains the
same source anchors while expanded, and its composer follows horizontal scrolling. Find reveals
matches within clipped columns. Source changes, mode changes, and document removal release any
expansion; the viewport's `source` prop carries the whole document for that release, falling back
to `contentKey`. Print rendering removes viewport clipping and expansion controls.

Fenced code passes its explicit language to `highlight.ts` only when a Code color scheme is enabled.
The tokenizer recognizes aliases for its supported language families; it does not detect languages
from code content. Missing or unsupported labels remain plain. The current tokenizer approximates
syntax rather than using complete language grammars; YAML is currently unsupported. Token text
concatenates to the original block text, including line endings. Coloring never changes the source.
