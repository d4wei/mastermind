# Document controls and panels

`TopBar` places standalone document controls at the top right. The Read/Markdown button shows the
mode it opens. Translation and active-comment controls appear where applicable; the overflow menu
contains Resolved and Settings. Resolved remains reachable without active comments. Radix supplies
menu focus, keyboard navigation, and dismissal. The native host owns the file pills and full-path
window title; the document controls do not repeat the filename.

The controls' measured height feeds `--bar-clear` in `app.css`; content, navigation, notices, and
panels clear that space. Outline navigation also accounts for the current toolbar rectangle. Print
styles omit controls and their reserved space. Keeping controls at the top avoids browser hosts
that overlay an input near the bottom of the viewport.

`Navigator` shows a compact heading-tick strip with the current section highlighted. Bar length
decreases at every heading depth; thickness uses a square-root scale of source length between
consecutive headings, including the final section through document end. This is a stable size
estimate, independent of rendered height. Both outline surfaces share square-ended bar geometry;
active state changes color without overriding depth or size. Hover, focus,
or a click opens its scrollable heading list without moving the document. Escape, outside clicks,
and leaving the unfocused control dismiss the list. Selecting a heading scrolls to its source
position and closes the list. Reading mode follows document scroll position; Markdown mode uses
its registered source scroller. The outline shares only headings and the article element through
`navStore`; expansion is transient component state.

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
