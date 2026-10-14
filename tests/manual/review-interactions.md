# Review interactions

This document is a manual exercise, not an automated fixture. Open a disposable copy in mastermind
so comments and suggested edits can be saved without changing this guide. Use the original-language
reading view for the selection checks.

## Checks

1. **Callouts:** Decisions, Open questions, To-do, and Risks below should each appear in an
   elevated, neutral card with a check, question, checklist, or warning icon respectively. The card
   ends at the next heading of equal or shallower depth. Matching depends on the heading title,
   not its depth; the trailing Notes heading should remain ordinary.
2. **Cross-block comments:** select from the first selection paragraph into the second. Choose
   Comment and submit a short message. Only the first markable source range becomes a highlighted
   comment anchor; the remaining selected ranges stay unchanged. Inspect Source to check the
   `{==…==}{>>…<<}` pair, then undo to restore the copy.
3. **Cross-block deletions:** repeat that selection and choose Suggest deletion. Each markable range
   gets its own deletion suggestion, without enclosing paragraph separators. Try selections from a
   paragraph into a list and from a list into the table as well. Existing marks and text that cannot
   be mapped safely to source may split or limit the ranges. An entirely unmarkable selection should
   not offer an actionable toolbar. Undo should restore the whole operation at once.
4. **Review actions:** accept or reject the deletion suggestion below and inspect Source for the
   corresponding text splice. Add a reply to the existing comment; feedback remains in the file
   with its author. Ordinary successful edits and review actions do not require a success toast.
5. **Error toast:** use a disposable copy. In the localhost browser preview, block its save request
   in browser developer tools. In the native app, remove write permission from the copy while
   retaining read permission; run as a user for whom that permission change denies writes. Make an
   edit and check that the failed save shows an error notice at the top right while retaining the
   local edit and the original disk bytes. Unblock the preview request or restore native write
   permission, then make another edit to retry. A disk version conflict instead opens the conflict
   controls; check that separately from a denied or unreachable save.

## Selection paragraphs

The first paragraph describes a small reading room with a table near the window. Begin a selection
in this sentence and drag into the next paragraph to exercise the boundary between two text blocks.

The second paragraph describes a shelf of reference books beside the door. Keep both paragraphs
free of existing review marks when checking a selection across their boundary.

A third paragraph provides another boundary for a longer selection. Try dragging in either direction
and compare the source ranges after suggesting deletion.

## Decisions

- Keep the reading room open during the afternoon.
- Place reference books on the lower shelf.
- Use {==printed labels==}{>>@Alex: Would larger type help readers?<<} for the shelf categories.

## Open questions

- [ ] Which books should be closest to the entrance?
- [ ] Is another reading lamp needed?
- [ ] Who will update the room notice?

## To-do

- [ ] Measure the shelf space.
- [ ] Draft the room notice.
- [ ] Check the lamp switch.
- [x] Count the chairs.

## Risks

- Direct sunlight may make small labels difficult to read.
- The doorway may become crowded when several readers arrive together.
- {--A sign across the doorway--} could obstruct access.

## Room layout

| Item  | Current position | Alternative position |
| ----- | ---------------- | -------------------- |
| Table | Near the window  | Beside the shelf     |
| Shelf | Beside the door  | Along the back wall  |
| Lamp  | On the table     | On a side stand      |

The code block provides a boundary for checking that a selection does not corrupt literal content:

```ts
for (const book of books) {
  placeOnShelf(book)
}
```

### Notes

This ordinary heading does not match a callout title. It also leaves a prose block after the code
example for selection checks that include the end of a literal block.

## Responsive controls

Use a disposable copy with a long filename. Check widths of 320, 768, and 1440 pixels with English
and Chinese interface labels, a translation language configured, and light and dark themes.

- Document controls remain at the top, with no overlap among active buttons or the navigator toggle.
  Narrow controls wrap, the filename clips, and settings remains reachable.
- The first heading starts below the controls. Scrolling and choosing an outline heading keep both
  the target heading and the controls visible. Repeat in Markdown mode.
- At narrow widths, comments start closed. The comments button or a document comment marker opens
  the panel; Close and Escape dismiss it. The document does not reserve an off-screen rail.
- Open settings, resolved history, comments, and Find. Panels fit the viewport and scroll inside;
  Find wraps. In a disposable conflict test, the fixed notice and comparison clear the toolbar.
- In the embedded browser, the host's bottom input does not cover document controls. Return any
  viewport override to its normal size after checking.
