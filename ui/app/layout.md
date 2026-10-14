# Document controls and panels

`TopBar` fixes document controls at the top of the viewport. Settings lives inside the bar. The
filename truncates, and control groups wrap when available width is insufficient. Its measured
height feeds `--bar-clear` in `app.css`; content, navigation, notices, and panels clear that space.
Outline navigation also accounts for the current toolbar rectangle. Print styles omit the controls
and their reserved space.

This placement keeps controls away from browser hosts that overlay an input near the bottom of the
viewport. The app does not detect the embedding host or assume a particular input height.

At the navigator's narrow breakpoint, comments use the shared dismissible panel instead of a second
content column. The panel starts closed and opens from the comments control or a document mark.
Cards flow vertically inside it. Wide layouts retain document-aligned cards. Settings, resolved
history, conflict comparison, and narrow comments share the overlay area.

Settings and history panels fit within the viewport width and scroll their bodies when needed.
Conflict notices remain fixed below the controls; comparison appears below the notice. Find controls
wrap to fit narrow widths. Long source/code lines can still scroll within their own content areas.

Regression tests cover settings controls in both interface languages, narrow comment access and
closure, and outline-scroll clearance with changing toolbar heights. The manual browser procedure
lives in `tests/manual/review-interactions.md`.
