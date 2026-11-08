# Document controls and panels

Both `html` and `body` paint the active theme's background. The native host also synchronizes its
under-page surface through the [theme appearance adapter](../theme/appearance.md).

`TopBar` places standalone document controls at the top right. In the desktop app, `ToolbarTarget`
portals them into the native file row so file pills use the remaining flex space. From left they
read: reading language, Find, comments, the Read/Markdown button, and the overflow menu. The
language and comments controls appear only where applicable, so they sit left of the mode button,
which keeps one place beside the overflow menu in both modes. The mode button shows the mode it
opens; the overflow menu contains Resolved and Settings. Resolved remains reachable without active
comments. Radix supplies menu focus, keyboard navigation, and dismissal. The native host owns the
file pills and full-path window title; the document controls do not repeat the filename. On macOS
the file toolbar shares the native traffic-light area without a separate title strip. See the
[native adapter](../desktop/README.md) for dragging and file-closing behavior.

The document and wide comment rail scroll together inside `.document-scroll`. The root viewport
does not scroll: file controls, outline, selection controls, notices, and overlay panels live
outside the document scroller, so elastic scrolling cannot carry them away. Both reading modes
use this container. `ui/util/scroll.ts` shares its bounds and position with navigation and review
controls; scroll listeners subscribe to the container itself. Printing removes the screen height
constraints.

The controls' measured height feeds `--bar-clear` in `app.css`; content, navigation, notices, and
panels clear that space. Outline navigation also accounts for the current toolbar rectangle. Print
styles omit controls and their reserved space.

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
The document view derives the headings and renders `Navigator` with them, the mounted reading
article, and the mounted editor's measurement callbacks; expansion is transient component state.
Reading mode takes the headings from its analysis. The view keeps its last analysis by source, so
switching modes with the source unchanged analyzes nothing; Markdown mode reads that analysis's
plain parse while it matches, and otherwise parses on opening and again only once edits pause, so
its outline and resolved count may briefly describe the previous source.
`Navigator` renders inside `.app-content`, before the controls; its fixed position keeps it out of the
document flow, and Find ignores its updates when watching for content changes.

`reading-space.ts` sizes the reading group from the available scroller width, preferred text width,
font size, outline strip, fixed card width, and gap. The outline reserves space only while visible;
opening its popup never changes that reservation. If cards fit in the centered document's right
margin, opening comments leaves the document in place. Otherwise the whole group is centered after
the outline strip. The rail reserves its card width and gap, with no unused flexible column.

Comments use the shared dismissible panel below the small-window breakpoint or when the inline
layout cannot preserve the minimum reading measure at the selected font size. The panel starts
closed and opens from the comments control or a document mark. Cards flow vertically inside it.
Wide layouts retain document-aligned cards. Expanded
tables temporarily hide this rail and the outline without changing their layout reservations; see
[table viewports](../modes/reading/rendering.md#table-viewports). Settings, resolved history, and panel
comments share the overlay area.

Changing inline comment visibility animates only horizontal displacement of the document column.
The comment rail fades in independently at its measured anchors; the inline rail first mounts in a
transition after the document renders, with its column already reserved. Hiding it keeps the two-column
layout while the rail fades out, then moves the document; leaving reading mode or the wide layout
removes the rail at once.
Text widths settle immediately. Resizing cancels the running movement rather than queuing another;
reduced motion changes position immediately. The animation uses the shared duration and easing.
The Web Animations duration converts CSS seconds or milliseconds explicitly; production CSS may
shorten the token to seconds.

The top-right region holds one floating surface at a time. Find, the file list, the language menu,
the document overflow menu, settings, and resolved history exclude one another through the one open
value in `overlayStore.ts`; opening any closes the others, so Find never stays open beneath a menu
or panel. Settings, resolved history, the overflow menu, and the language menu belong to the
document view that opened them and close with it; Find keeps its per-document open state. Find
mounts on its first request (the shortcut, the toolbar button, or a native command, replayed once
it mounts) or once the view is idle, so its editor-search chunk stays out of the first render. Surfaces
that hold a draft are not overlays and never close for one: menus stack above the selection and
reply composers. The selection toolbar stays below the document controls and clear of Find,
opening below its selection when there is no room above. Find floats above an expanded table, and
the narrow comments panel moves below Find rather than closing it. On narrow layouts, opening settings or resolved history closes
comments. Settings-save feedback belongs to application
preferences and can appear without an active document.

Settings, history, and Find share `--panel-width` and fit within the viewport width; panels scroll
their bodies when needed. A panel's compact close control lines its glyph up with the body's content
inset while keeping a full hit target.
`Notifications` places a bounded, scrollable stack at the bottom left, outside document scrolling;
Find floats below the top-right document controls. Conflict state also appears on file tabs. The
[notification contract](notifications.md) owns the persistent and transient tiers and classifies
every notice.
Find controls wrap to fit narrow widths. Long source/code lines can still scroll within their own
content areas.

Regression tests cover both interface languages, overflow access, narrow comments, outline
expansion and progress, and scroll clearance. The manual checklist lives in
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

Suggest change opens one Markdown replacement field per editable selected fragment. A single field
has no label; several are numbered as parts in source order. An empty field suggests deletion, as
its placeholder says; an unchanged field emits no edit. Fragment boundaries preserve intervening marks,
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
surface. Search matches use the find fills described in the [Find notes](../find/README.md), independent
of focus, and clear when no match remains or Find closes.
