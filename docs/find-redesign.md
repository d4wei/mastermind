---
status: living
updated: 2026-10-17
exit: The approved Find behavior is implemented, tested, and documented beside its code.
---

# Find in document

## What is broken

The current Find panel searches CriticMarkup comments and suggested edits only. It does not search
ordinary document text. Native verification found no results for a word occurring throughout the
body. The label “All” means all review marks, not all document content.

Markdown view installs no CodeMirror search extension or search keymap; Command-F did nothing in the
native check. Translated reading explicitly excludes the Find panel. The toolbar and native Edit
menu have no Find entry. Opening the current panel also jumps to a mark before any query is entered,
and repeated Command-F can toggle it closed instead of returning focus to the query.

## Proposed experience

Use **Find / 查找**, with **Find in document / 在文档中查找** as the field label. Add a magnifying-glass
button beside the view toggle, with the same size, weight, hover, and focus treatment as its peers.
Also expose Edit → Find in the native menu. Disable these entries when no document is open.

Use a compact floating panel below the top-right controls, fixed outside document scrolling.
Opening Find does not move the document. Short queries do not justify a full-width row; keep the
field and its controls together without stretching across unused space. Match navigation must
reveal the current result outside the panel's footprint.

The panel contains the query, an occurrence count, previous and next arrows, Match case, and Close.
There is no review-mark filter in the initial design. Search is literal and case-insensitive by
default, scoped to the active file. Replacement and cross-file search are outside this change.

## What gets searched

| View | Searchable text |
| --- | --- |
| Reading | Body, frontmatter keys and values, code, suggested edits, and unresolved comments |
| Translated reading | The displayed translation; no invisible original text |
| Markdown | The entire editable source, including markup and the resolved-comment archive |

Reading search follows text across adjacent inline formatting, such as bold or links, without
matching across unrelated blocks or different comments. Count individual occurrences, not threads.
Do not index toolbar labels, duplicated quote previews, hidden Markdown syntax, or the resolved
archive in reading view. Link text is searchable; an invisible link destination is source-only.

A comment result reveals its thread and the matching reply, opening the comments panel if needed.
It does not open a reply composer or modify the file. Closing Find restores a panel it opened unless
the user explicitly changed that panel. Resolved discussions remain accessible through Resolved;
searching the entire raw file remains available in Markdown view.

## Interaction and state

- Command-F or Ctrl-F opens Find and focuses/selects its query. Repeating it refocuses; it never
  closes Find. Opening with a single-line document selection seeds the query. A selection inside
  a comment composer or another input does not replace the query.
- An empty query has no matches or automatic scroll. Typing selects the first occurrence at or
  after the current reading position, wrapping if necessary. Show “1 of 8 / 第 1 项，共 8 项” or
  “No results / 无结果”; disable navigation when empty or unmatched.
- Enter and Shift-Enter move next and previous. Command-G and Shift-Command-G do the same on macOS;
  use Ctrl-G and Ctrl-Shift-G on Windows. Navigation wraps. Announce wrap and result position to
  assistive technology without adding persistent chrome.
- Highlight every occurrence quietly and distinguish the current one with an additional outline.
  Search emphasis must be distinguishable from review markup and must not change document bytes
  or disrupt selection/comment creation. Scroll only enough to reveal the current match clear of
  the floating panel.
- Escape or Close dismisses Find and clears its highlights. Return focus to the document/editor or
  invoking button as appropriate; preserve source selection and editing history.
- Retain query, case setting, and open state per document for the current app session. Recompute
  results on mode changes, translation changes, and content edits. Counts may differ by view under
  the scope table above. A content update must not steal typing focus or retain stale ranges.
- Honor IME composition: Enter confirms Chinese input before it can navigate results. Keyboard
  commands inside unrelated inputs must not accidentally submit or alter a draft.
- At narrow widths, constrain the panel to the viewport and wrap its field and controls into two
  rows as needed. Keep file controls and recovery notices accessible. Respect reduced motion.

## Implementation boundaries

Use CodeMirror's search package for source search and decorations, with the common Find controls
bound to its query and navigation commands. Pin the direct dependency when adopted. Avoid a second
independent search panel or keymap competing with the common controls.

For reading, index presented text with mappings to DOM text ranges and comment identities. Validate
range highlighting in the native WebKit host before choosing CSS Custom Highlight or renderer-owned
decorations. Do not rewrite rendered HTML through string replacement, and do not rely on browser
native Find as a second hidden search system. Keep the pure matching/index tests separate from DOM
range, focus, scrolling, and editor integration checks.

Reference behavior: [TextEdit Find](https://support.apple.com/en-mn/guide/textedit/txtef6cfde1a/mac)
uses a search field, navigation arrows, Enter, and Edit → Find. The
[CodeMirror reference](https://codemirror.net/docs/ref/#search) provides search state, commands,
keybindings, and configurable panels. These are references for the proposal, not claims that the
current app already provides their behavior.

## Verification before shipping

Exercise visible-button and shortcut entry; repeated open; English and Chinese queries; Apple
Pinyin composition; empty/no/multiple matches; forward/backward wrap; inline-format boundaries;
frontmatter, code, suggestions, and collapsed replies; source virtualization; translated reading;
file/mode changes; external updates; narrow windows; focus restoration; and no file writes from
search alone. Run the full tests, both typechecks, and the native build, then repeat the principal
flows in the native app. Floating placement is settled in `DECISIONS.md`; the remaining behavior
is specified above.
