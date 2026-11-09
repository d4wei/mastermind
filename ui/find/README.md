# Find in document

Find is a floating panel below the document controls. The toolbar button, native Edit menu, and
Command-F / Ctrl-F open or refocus it. A document selection seeds a newly opened query; selections
in composers and other inputs do not. Query, case setting, and open state survive file switching
within the app session and disappear when the file closes.

Queries are literal and case-insensitive unless Match case is enabled. Results count occurrences,
not review marks. Reading searches rendered prose, frontmatter, code, suggestions, and unresolved
comment bodies, including collapsed replies. Inline formatting does not break a phrase; unrelated
blocks do. Repeated quote previews, hidden syntax, resolved archives, and toolbar labels are
excluded. Translated reading searches its displayed content and appended discussions once, without
opening the original document's comment rail. Markdown searches the complete source.

Every match takes the saturated `--find-match-bg` fill and the current match `--find-current-bg`,
both with `--find-match-text` ink and without an underline or outline; the fills stay distinct from
the translucent review highlight. A compact `current/total` counter (`0/0` without matches) sits
right-aligned inside the field, whose padding reserves its space, so typing never runs under it and
the panel keeps one width; a visually hidden live region announces the full phrase. The panel takes
`--panel-width`, the width Settings and Resolved share, and the field fills what the controls
leave; its four compact square controls stay grouped when a narrow window wraps the panel. Opening another top-right surface closes
Find; see the [layout contract](../app/layout.md).

`matches.ts` uses the pinned CodeMirror search package for literal matching and Unicode offsets;
its ASCII fast path returns the same matches natively, which `tests/find-reading.test.ts` compares.
`reading.ts` maps displayed text to DOM ranges without rewriting the renderer's nodes and paints
them through the CSS Custom Highlight helper in `ui/util/highlights.ts`. Its `ReadingIndex` keeps
the displayed text until a searchable DOM mutation, so a query or case change only rematches.
One- and two-character queries on documents over the length constant in `FindPanel.tsx` wait for a
brief typing pause, keeping the previous results meanwhile; Enter searches them at once. Comment
search uses the same whitespace normalization as `CommentBody`, then maps the visible result when
its thread opens. `source.ts` connects CodeMirror's query, match decorations, and scrolling to the
shared controls. Its internal panel has no visible controls. Search navigation preserves the
original editor selection, mapping it through intervening edits before restoring it on close.

Typing starts at the first result at or after the current position, wrapping if needed. Enter and
Shift-Enter navigate; Command-G / Ctrl-G and their Shift variants do the same. Empty queries neither
highlight nor scroll. Escape closes Find unless an unrelated text input or active IME composition
owns it. A pointer press anywhere outside the panel also closes it, including a press on a match in
the document; it returns focus as the close control does and leaves the press's own selection or
action intact. Presses on the toolbar Find button, in another floating layer such as portaled menu
or popover content, or while the close dialog or an inert root is up leave it open; the rule is
shared with the other dismissible surfaces in [outside presses](../util/outside-press.md). Search never writes a file, submits a draft, or moves focus into a reply field; revealing
a comment selects its discussion, whose reply field then shows unfocused.

A result inside a collapsed reply opens its thread. If Find opened the comments panel, closing Find
restores its previous closed state unless the person explicitly changed it. A narrow comments panel
keeps its controls below Find and does not take input focus when opened by search. Navigation
reveals results clear of the floating panel. Content updates recompute ranges without stealing
focus. Closing Find removes highlights; source history remains intact.

The tests in `tests/find-feedback.test.tsx`, `tests/find-outside-click.test.tsx`,
`tests/find-reading.test.ts`, and `tests/source-editor.test.tsx` cover matching, displayed scopes,
outside-press dismissal, keyboard and composition guards,
range cleanup, source virtualization, selection restoration, and undo preservation. Native checks
remain necessary for webview painting, scrolling, menu dispatch, and real input-method behavior.
