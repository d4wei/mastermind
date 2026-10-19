---
status: living
updated: 2026-10-19
exit: Confirm and ship the table expansion design, then graduate its contract beside the renderer.
---

# Reading wide tables

Horizontal scrolling recovers hidden content but makes prose-heavy tables difficult to compare.
Comments sit beside the prose column, so there is no unused space immediately to its right.

## Proposed interaction

In the normal state, the table's viewport matches the body width and scrolls horizontally. Fade
content at an edge only while more content is hidden beyond that edge. At the leftmost position,
the left fade disappears; at the rightmost position, the right fade disappears. Keep the scrollbar
usable and outside the faded area.

An explicit Expand table action widens that viewport to the window's safe content bounds. Comments
and the progress tracker fade away without changing the surrounding prose layout. The table stays
at the same vertical position, with the same height. Prose above and below remains in place.
Collapse table or Escape restores the normal viewport, its previous horizontal scroll position,
and the prior visibility of the comments and progress tracker. Return keyboard focus to the table
control. Hidden controls must also leave keyboard navigation and the accessibility tree.

## Stable table geometry

Use one rendered table in both states. Determine its column widths independently of the normal
viewport and retain those widths during expansion and collapse. Preserve font size, cell padding,
text wrapping, row heights, source anchors, and selection. Animate the viewport's horizontal
position and width; do not scale text or interpolate column widths.

Stable geometry does not mean unbounded max-content sizing: a paragraph in one cell must not make
an enormous single-line column. Choose readable column widths against the expanded space, allowing
long content to wrap. A table that still exceeds that space remains horizontally scrollable in
both states. Small tables keep their natural size and need no expansion control.

The initial preview uses a fixed column allocation to isolate the transition. Production column
sizing still needs validation with real documents, long identifiers, and Chinese prose. Window
resizing is a separate layout change and may require recalculating widths; switching table states
must not trigger that recalculation.

## Transition and return

Fade the side UI away as expansion begins. Reveal it again after collapse has cleared its space.
Preserve the page's vertical scroll position. While expanding, retain the current horizontal offset
where valid and smoothly clamp it where the wider viewport removes overflow. Restore the saved
normal offset during collapse. Rapid reversals should continue from the current geometry rather
than restart from an endpoint. Reduced motion switches states without geometric animation.

## Remaining interaction question

Reviewing a table must retain exact source mapping. Decide how opening a discussion or composing a
comment behaves while expanded: a temporary comment overlay could preserve the table width, while
returning to the normal view would restore the existing anchored cards. The preview explores the
reading transition only; it does not settle this review interaction.

## Verification before implementation ships

Check narrow and wide windows, short and long tables, long prose and identifiers, and English and
Chinese text. Verify edge fades at both ends, scroll restoration from the middle and far end,
rapid reversals, reduced motion, keyboard return, window resizing, selection, search, and comments.
Measure column widths and row heights before and after toggling to detect unwanted reflow.
