# Document controls and panels

Both `html` and `body` paint the active theme's background. The native host also synchronizes its
under-page surface through the [theme background adapter](../theme/background.md).

`TopBar` places standalone document controls at the top right. The Read/Markdown button shows the
mode it opens. Translation and active-comment controls appear where applicable; the overflow menu
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

`Navigator` shows a compact heading-tick strip with the current section highlighted. Inactive bars
shorten at every heading depth; the active section always has the longest bar. Both outline surfaces
use uniform thickness and square ends. The popup aligns bars in a fixed left column and indents only
heading labels, so changing the active section does not shift the text. Hover, focus,
or a click opens its scrollable heading list without moving the document. Escape, outside clicks,
and leaving the unfocused control dismiss the list. Selecting a heading scrolls to its source
position and closes the list. Both modes follow document scroll position.
Reading mode measures rendered headings; Markdown mode uses CodeMirror line geometry, including
off-screen headings. Its scroll effect remeasures virtualized lines before positioning the target.
`navStore` shares headings, the reading article, and the mounted editor's measurement callback;
expansion is transient component state.

At the narrow breakpoint, comments use the shared dismissible panel instead of a second content
column. The panel starts closed and opens from the comments control or a document mark. Cards flow
vertically inside it. Wide layouts retain document-aligned cards. Settings, resolved history,
conflict comparison, and narrow comments share the overlay area.

`SessionView` owns settings, find, and resolved history as one transient panel choice. Opening
comparison closes that choice; closing comparison preserves the document-owned draft. On narrow
layouts, opening another panel closes comments. Settings-save feedback belongs to application
preferences and can appear without an active document.

Settings and history panels fit within the viewport width and scroll their bodies when needed.
Conflict notices remain fixed below the controls; comparison appears below the notice. Find controls
wrap to fit narrow widths. Long source/code lines can still scroll within their own content areas.

Regression tests cover both interface languages, overflow access, narrow comments, outline
expansion and progress, and scroll clearance. The manual browser procedure lives in
`tests/manual/review-interactions.md`.
