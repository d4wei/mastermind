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

The current match uses a darker neutral fill without an additional underline or outline. The count
uses tabular digits and reserves the width of the largest result number, keeping navigation still.
Its four compact square controls stay grouped when the panel wraps.

`matches.ts` uses the pinned CodeMirror search package for literal matching and Unicode offsets.
`reading.ts` maps displayed text to DOM ranges without rewriting the renderer's nodes. Comment
search uses the same whitespace normalization as `CommentBody`, then maps the visible result when
its thread opens. `source.ts` connects CodeMirror's query, match decorations, and scrolling to the
shared controls. Its internal panel has no visible controls. Search navigation preserves the
original editor selection, mapping it through intervening edits before restoring it on close.

Typing starts at the first result at or after the current position, wrapping if needed. Enter and
Shift-Enter navigate; Command-G / Ctrl-G and their Shift variants do the same. Empty queries neither
highlight nor scroll. Escape closes Find unless an unrelated text input or active IME composition
owns it. Search never writes a file, submits a draft, or opens a reply composer.

A result inside a collapsed reply opens its thread. If Find opened the comments panel, closing Find
restores its previous closed state unless the person explicitly changed it. A narrow comments panel
keeps its controls below Find and does not take input focus when opened by search. Navigation
reveals results clear of the floating panel. Content updates recompute ranges without stealing
focus. Closing Find removes highlights; source history remains intact.

The tests in `tests/find-feedback.test.tsx`, `tests/find-reading.test.ts`, and
`tests/source-editor.test.tsx` cover matching, displayed scopes, keyboard and composition guards,
range cleanup, source virtualization, selection restoration, and undo preservation. Native checks
remain necessary for webview painting, scrolling, menu dispatch, and real input-method behavior.
