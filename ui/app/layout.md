# Document controls and panels

Both `html` and `body` paint the active theme's background. The native host also synchronizes its
under-page surface through the [theme appearance adapter](../theme/appearance.md).

`TopBar` places standalone document controls at the top right. In the desktop app, `ToolbarTarget`
portals them into the native file row so file pills use the remaining flex space. The Read/Markdown
button shows the mode it opens. Translation and active-comment controls appear where applicable; the overflow menu
contains Resolved and Settings. Resolved remains reachable without active comments. Radix supplies
menu focus, keyboard navigation, and dismissal. The native host owns the file pills and full-path
window title; the document controls do not repeat the filename. On macOS the file toolbar shares
the native traffic-light area without a separate title strip. See the
[native adapter](../desktop/README.md) for dragging and file-closing behavior.

The document and wide comment rail scroll together inside `.document-scroll`. The root viewport
does not scroll: file controls, outline, selection controls, notices, and overlay panels live
outside the document scroller, so elastic scrolling cannot carry them away. Both reading modes
use this container. `ui/util/scroll.ts` shares its bounds and position with navigation and review
controls; scroll listeners subscribe to the container itself. Printing removes the screen height
constraints.

The controls' measured height feeds `--bar-clear` in `app.css`; content, navigation, notices, and
panels clear that space. Outline navigation also accounts for the current toolbar rectangle. Print
styles omit controls and their reserved space. Keeping controls at the top avoids browser hosts
that overlay an input near the bottom of the viewport.

`Navigator` shows a compact heading-tick strip when the document has at least two headings, with
the current section highlighted. Inactive bars shorten at every heading depth; the active section
always has the longest bar. Both outline surfaces use uniform thickness and square ends. The popup
aligns bars in a fixed left column and indents only
heading labels, so changing the active section does not shift the text. Hover, focus,
or a click opens its scrollable heading list without moving the document. Escape, outside clicks,
and leaving the unfocused control dismiss the list. Selecting a heading scrolls to its source
position and closes the list. Both modes follow document scroll position.
Reading mode measures rendered headings; Markdown mode uses CodeMirror line geometry, including
off-screen headings. Its scroll effect remeasures virtualized lines before positioning the target.
`navStore` shares headings, the reading article, and the mounted editor's measurement callback;
expansion is transient component state.

`reading-space.ts` sizes the reading group from the available scroller width, preferred text width,
font size, outline strip, fixed card width, and gap. The outline reserves space only while visible;
opening its popup never changes that reservation. If cards fit in the centered document's right
margin, opening comments leaves the document in place. Otherwise the whole group is centered after
the outline strip. The rail reserves its card width and gap, with no unused flexible column.

Comments use the shared dismissible panel below the small-window breakpoint or when the inline
layout cannot preserve the minimum reading measure at the selected font size. The panel starts
closed and opens from the comments control or a document mark. Cards flow vertically inside it.
Wide layouts retain document-aligned cards. Settings, resolved history, and panel comments share
the overlay area.

Changing inline comment visibility animates only horizontal displacement of the document column.
The comment rail fades in independently at its measured anchors.
Text widths settle immediately. Resizing cancels the running movement rather than queuing another;
reduced motion changes position immediately. The animation uses the shared duration and easing.
The Web Animations duration converts CSS seconds or milliseconds explicitly; production CSS may
shorten the token to seconds.

`SessionView` owns settings, find, and resolved history as one transient panel choice. On narrow
layouts, opening another panel closes comments. Settings-save feedback belongs to application
preferences and can appear without an active document.

Settings and history panels fit within the viewport width and scroll their bodies when needed.
`Notifications` places a bounded, scrollable stack at the bottom left, outside document scrolling.
Conflict recovery, save failures, and translation feedback share it; Find retains the top-center
slot. Dismissed failures remain reachable from a compact control. Conflict state also appears on
file tabs. Informational notices dismiss completely. Error notices retain an icon-only warning
control that reopens their content. Successful transient messages expire; unresolved failures do
not disappear on a timer.
Find controls wrap to fit narrow widths. Long source/code lines can still scroll within their own
content areas.

Regression tests cover both interface languages, overflow access, narrow comments, outline
expansion and progress, and scroll clearance. The manual browser procedure lives in
`tests/manual/review-interactions.md`.

## Reading and review presentation

Rendered headings scale with body text instead of viewport width. Prose blocks share a bottom gap;
section headings add a larger top gap. Nested lists do not add a paragraph gap around themselves.
Font presets and the reader's size and line-height settings remain independent of this rhythm.

Each discussion has one interactive document target. Commented passages use a dotted underline and
an active or hover fill. Only unanchored discussions have a diamond, one per discussion rather than
per reply. Hover connects the passage and card without moving either; activation opens the reply
composer in the [anchored compact discussion](../review/comment-rail.md). Search results for any
reply navigate to that same visible target. Hidden comment references remain available to print
footnote
numbering. Standalone highlights render as plain text; insertions, deletions, and replacements
retain edit styling.

Suggest change opens one Markdown replacement field per editable selected fragment. An empty field
suggests deletion; an unchanged field emits no edit. Fragment boundaries preserve intervening marks,
code, and block structure. Unrepresentable replacement text is rejected without sanitizing it.
The composer retains IME handling and pauses submission while the file has a conflict.

The document scrollbar reserves a constant width at the window edge. Its thumb appears while
scrolling or pointing at that edge and hides after idle; hiding it does not shift the document.

## Focus feedback

Keyboard navigation uses `:focus-visible` with one neutral ring across controls. Pointer clicks do
not add a ring to buttons. Text fields strengthen their existing boundary while focused; the source
editor uses its caret rather than a page-sized outline. Inverted composers use a local light ring.
Panels move keyboard focus inside on open and return it to the invoking control on dismissal;
clicking elsewhere keeps focus at the clicked destination. Radix menu items use the highlighted row
surface. Search matches use an inline wash and underline, independent of focus, and clear when no
match remains or Find closes.
