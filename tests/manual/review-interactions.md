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
   comment anchor; the remaining selected ranges stay unchanged. Inspect Markdown to check the
   `{==…==}{>>…<<}` pair, then undo to restore the copy.
3. **Cross-block changes:** repeat that selection and choose Suggest change. Each editable fragment
   gets a replacement field. Edit one field and clear another to suggest replacement and deletion,
   without enclosing paragraph separators. Unchanged fields produce no mark. Try selections from a
   paragraph into a list and from a list into the table as well. Existing marks and text that cannot
   be mapped safely to source may split or limit the ranges. An entirely unmarkable selection should
   not offer an actionable toolbar. Undo should restore the whole operation at once.
4. **Review actions:** accept or reject the deletion suggestion below and inspect Markdown for the
   corresponding text splice. Add a reply to the existing comment; feedback remains in the file
   with its author. Ordinary successful edits and review actions do not require a success toast.
5. **Save error notification:** use a disposable copy. Remove write permission from the copy while
   retaining read permission; run as a user for whom that change denies writes. Make an edit and
   check that the failed save shows an error notice at the bottom left while retaining the local
   edit and the original disk bytes. Restore write permission, then make another edit to retry. A
   disk version conflict instead opens the conflict controls; check that separately from a denied or
   unreachable save.
6. **Native file toolbar:** on macOS, traffic lights share the file toolbar without a separate
   title strip, with balanced top and left insets. Drag empty toolbar space to move the window;
   Open, file pills, close buttons, and document controls should remain clickable. Open three
   disposable files, close the middle active file, then a background file, then the last file.
   Check neighbor selection and the empty opening screen. Reopen a closed file and check that its
   disk contents remain unchanged. Repeat after a local edit, a save failure, and an unresolved
   file conflict; unsaved work must keep its file open.

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
and Chinese interface labels, a prepared translation, and light and dark themes.

- Document controls remain at the top right, with Settings and Resolved in the overflow menu. The
  square Open button and file pills stay at the top left. Long filenames clip, pills that do not fit
  move into a counted overflow list that keeps the active file visible, and the active file's full
  path appears in the native window title.
  Hover an inactive file pill: its background and text respond while the active pill stays distinct.
- The compact outline shows heading ticks and the current section. Hover, click, or focus opens the
  heading list; Escape closes it and returns keyboard focus to the trigger. Scroll the document and
  check that the current-section indicator follows it.
- With headings from H1 through H6, bars have uniform thickness and square ends. Inactive bars
  shorten at each depth; the active bar is always longest. In the popup, bars share a left edge
  while labels retain their indentation. Changing sections does not shift the labels.
- Frontmatter property rows have only a bottom divider, with breathing room before the document
  body. Literal YAML fallbacks retain their code-block spacing.
- The first heading starts below the controls. Scrolling and choosing an outline heading keep both
  the target heading and the controls visible. Repeat in Markdown mode.
  In a long Markdown document, select an outline heading far outside the current editor viewport,
  then scroll by hand. Navigation reaches the source heading and the active bar follows scrolling.
  Switch back to reading view and check that tracking still follows the displayed headings.
- At narrow widths, comments start closed. The comments button or a document comment marker opens
  the panel; Close and Escape dismiss it. The document does not reserve an off-screen rail.
- Open settings, resolved history, comments, and Find. Panels fit the viewport and scroll inside;
  Find wraps. In a disposable conflict test, the bottom-left recovery notice coexists with Find
  and clears the toolbar.
- Overscroll the top and bottom in light and dark themes, then change themes and repeat. The
  revealed surface matches the current page background in both reading modes. File controls,
  outline, and open overlay panels stay fixed throughout scrolling and overscroll.
- Hover paragraphs and move along their right edges: no section action menu should appear.
  Select text instead and check that Comment and Suggest change remain available.

## File conflict recovery

Use disposable files. Create local edits while writes are denied, then restore permission and
change a different paragraph on disk. Check that editing pauses, existing comment drafts remain,
and the file tab shows Needs attention. Dismiss and reopen recovery; repeated watcher events must
not expand the dismissed notice. Other files and Find remain usable.

Recovery offers Save As and Use incoming for a verified conflict, or Retry and Save As for a
read/write failure or missing file. Use incoming replaces the same notice with confirmation; no
second box opens. Review undo can recover the old buffer. Delete the original and check that no
recovery operation silently recreates it. Dismissed recovery becomes a small warning icon.

Save As opens the native save picker. Cancel and check retained text, then try an existing
destination and check that it is unchanged. Choose a new destination and check that the new file
has the local text, the original disk file is unchanged, and the app switches to the copy.
Composer drafts remain available in the copy but are not included in its saved Markdown.
Check readable notification and hover colors in a light and dark theme at narrow window widths.

## Closing with pending work

Use disposable files. Closing a file normally waits for autosave and closes silently. A slow save
shows a cancellable progress sheet; Cancel stops closing while the dispatched write may finish.
Closing a clean file with an old warning must not be blocked.

After a failed save, closing offers Save As, Don't Save, and Cancel. Cancel returns to the file;
Don't Save closes without changing disk. Save As writes the local buffer to a new destination and
closes the original tab. Cancelling its picker returns to the same close sheet without an error;
a failed copy shows its error in that sheet. During quit, successful copies disappear from the
remaining-file list. The recovery notice is hidden while the close sheet or picker owns focus.

Type a comment, suggestion, or reply without submitting. Switch files and reading modes, then
return and check that the draft remains. Close or quit: Discard Drafts and Cancel are the only
choices. Cancel returns to the original composer; no duplicate input appears in the sheet. Cancel
must preserve the existing input and selection when its composer stayed mounted. Repeat with
Apple Pinyin composition. Discard affects only the drafts in the listed files.

Change the selected passage externally while a comment/suggestion draft is open. Its text remains
available, but submission against old offsets is disabled. Remove a thread while a reply is being
written: the reply remains copyable without being attached to another thread. Repeat in translated
reading after invalidating its translation. Drafts are temporary app memory, not restart recovery.

## Reading balance and control feedback

Compare comments hidden and visible in a wide window: the document stays in place when the cards
fit beside it. In a constrained window, the document and cards form a balanced group after the
outline strip. No flexible empty column remains beyond the cards. Increase font size and text
width: comments switch to their panel before the reading measure becomes too narrow. Expand the
outline; its popup does not move the document. Compare a document with fewer than two headings.

Toggle comments repeatedly and resize during movement. Horizontal movement must not accumulate,
text width must not animate, and reduced motion must switch directly. Check the active passage,
selection, and open composer during these changes.

Compare Open, Markdown, Comments, and More: matching button surfaces and icon weight, including the
selected Comments state. Across all themes, compare ordinary, hovered, pressed, selected, disabled,
and keyboard-focused controls on both the page and raised surfaces. Sepia comments use brown and
Rose comments plum; insertion and deletion keep their separate meanings.

## Comment activation, motion, and focus

- Toggle comments in wide and narrow windows. Cards fade in at their anchors; no card descends from
  the top. The wide document moves horizontally only when space requires it. Check reduced motion.
- Quotes remain visible on collapsed cards. Click an anchor, card body, author, or reply count; the
  matching reply field receives the caret. Repeat after cancelling, and while a draft is open.
- Drag to select passage or comment text; no reply opens. Hover pairs the passage and card without
  changing layout. Escape closes a reply and returns focus to its card control.
- Tab through file controls, document controls, settings, outline, and comments in light and dark
  themes. Keyboard focus is visible; clicking a button adds no ring. Inputs have one focused border.
- Search for a mark, then a nonexistent term. The result highlight clears and remains distinct from
  focus in the search field. Check inverted selection composers and Markdown editor caret focus.

## Theme color roles

- In Grid, Sepia, and Mint, inspect a selected comment and an open reply composer. Underline and
  card border follow the theme accent; submission uses a filled accent button with readable text.
- Inspect primary actions at rest, hover, pressed, focused, and disabled, including selection
  composers on inverted surfaces. Secondary actions retain neutral treatment.
- Switch between light and dark themes. Inspect native controls while focused and inactive;
  macOS traffic lights remain system-drawn. Inspect menus and elastic-scroll backgrounds too.
- Print a document containing comments, insertions, deletions, highlights, and colored code from
  both a light and dark theme. The print palette remains light with distinct review roles and
  neutral code ink.

## Wide tables

Use disposable tables with long prose, Chinese text, long identifiers, and comments in cells.
Compare narrow and wide windows. Small tables should have no expansion control. A wide table should
scroll inside the prose width, with fades only at edges that hide content.

Expand from the middle and far end, then collapse. Cell widths, wraps, table height, and the prose
below must stay fixed; collapse restores the original horizontal offset. Comments and outline fade
away while expanded and return afterward. When the expanded content fits, no scrollbar remains.
An unbreakable value wider than the window must still be reachable by horizontal scrolling.

Reverse a transition quickly, resize during it, and repeat with reduced motion. Tab to the icon and
use Escape to collapse. Search for text in a clipped column; it must scroll into view. Select table
text and open a comment or suggestion; scrolling must keep its composer aligned. Activate an
existing comment: the table collapses and the matching reply field receives focus. Change documents
or reading modes while expanded and check that the outline and comments return. Print must omit
expansion controls and expose the table.
