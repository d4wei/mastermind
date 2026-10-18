---
status: living
updated: 2026-10-17
exit: Adopt the layout and palette refinements, graduate their contracts, then delete this design.
---

# Review layout and visual feedback

Recovery and close behavior now follow the accepted simplified model. Their authoritative contracts
live in [document state](../ui/documents/store.md) and [draft lifetime](../ui/review/drafts.md).
This design retains the remaining visual work; the intermittent comment-triggered warning and
persisted buffers remain separate entries in DIRECTION.md.

## Comment layout and movement

Use the document width, fixed card width, gap, outline strip, and viewport as layout inputs. The
outline occupies visual space on the left even though it is narrow. Center the reading group in
the space remaining to its right, rather than treating that strip as empty margin. This produces a
smaller outer gap on the right than on the left and should be compared at several window widths.
The correction applies only while the outline is visible, including its absence in source view.
Do not move the document when the outline expands on hover; its popup overlays the reserved strip.

- If the right margin fits the cards and their gap, keep the document at its no-comments position.
- Otherwise, center the document-plus-comments group in the remaining reading area. Allocate
  only the rail width that cards use, rather than a whole flexible column beyond a capped card.
- If the combined group cannot fit while keeping a readable document width, use the Comments panel.
  Large text and user-selected text widths participate in this calculation.
- Animate only the necessary horizontal relocation on adding/removing the rail, around 180 ms.
  Use measured old/new positions; avoid interpolating text width through continuous reflow. Keep
  the active passage at its scroll position and remeasure card anchors after the layout settles.
- Reduced motion changes position immediately. Resizing must not accumulate running animations.
  A selected passage, composer, and comment card must remain attached throughout the transition.

## Theme and control audit

Preserve semantic roles across all seven themes. Theme accent belongs to application actions;
insertion, deletion, comments, and warnings keep separate meanings and shape/text cues. A palette
may vary the hues without turning every selected item into the accent color.

| Theme | Current comment color | Proposed direction |
| --- | --- | --- |
| Grid | Blue | Retain restrained blue; compare against red application accent |
| Sepia | Saturated blue | Warm muted ochre/brown, distinct from deletion and warning |
| Rose | Blue | Muted plum; distinguish from rose accent and deletion |
| Cobalt | Violet | Retain violet; check separation from blue application accent |
| Nacht | Violet | Retain palette-compatible violet; check on both dark surfaces |
| Slate | Violet | Reduce saturation if it dominates; retain semantic separation |
| Carbon | Pale violet | Check brightness and contrast against neutral chrome |

These are palette directions for a rendered comparison, not approved hex values. Review insertion,
deletion, comment underline, active card, hover fill, selection, focus, warning, and code colors
in the same specimen. Check ordinary, hovered, pressed, selected, disabled, and focused controls
against both page and elevated surfaces. Verify neutral hover is visible in every theme and remains
distinct from pressed and selected states. Film grain cannot be what makes a control visible.

Normalize controls at three separate levels: hit area, icon geometry, and interaction state. Use
one outline icon family, a shared stroke weight, and equal optical bounds; enclosed shapes may need
a slightly smaller footprint than open shapes. Equal nominal SVG dimensions alone are insufficient.
Use the same quiet button surface and border for Open, Source, Comments, and More. Keep the same
comment glyph in both states; indicate selection with a restrained surface change rather than a
heavier border plus stronger fill plus darker glyph. Check the whole row in normal, hover, selected,
and keyboard-focus states in every theme. Exact optical adjustments remain a visual decision.

## Implementation and verification

Compare the full theme specimen and wide/constrained comment layouts before selecting final palette
values. Apply layout, control, and theme changes together so movement, optical balance, and semantic
colors can be assessed in context.

Check narrow/wide windows, changed text width and font size, long Chinese labels, crowded comments,
keyboard operation, reduced motion, and focus restoration. Check every theme on page and elevated
surfaces, including selected-plus-hovered and disabled controls. Graduate the resulting contracts
into layout and theme documentation, then delete this design.
