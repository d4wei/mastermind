# Markdown parser patches

`processor.ts` parses through `remark-parse`, which tokenizes with micromark. Micromark 4.0.2
truncates its event array by assigning `events.length` whenever the tokenizer backtracks or closes
containers. JavaScriptCore, the engine behind the macOS webview, makes that assignment linear in
the array's length, so parsing grows quadratically with document size there; V8 does not.

[`patches/micromark+4.0.2.patch`](../../patches/micromark+4.0.2.patch) replaces each truncation in
`create-tokenizer.js` and `initialize/document.js` (both the `lib/` and `dev/lib/` builds) with a
pop loop and changes nothing else. The `postinstall` script applies it through the pinned
`patch-package`; an install with `--ignore-scripts` must run `npx patch-package` afterwards.

`tests/micromark-truncation.test.ts` checks that the installed micromark is the patched version
and carries the pop loops, and that the parser reproduces trees recorded from unpatched micromark.
Re-derive the patch, or drop it, when micromark changes version; 4.0.3 still truncates in
`create-tokenizer.js`.

## Autolink literal lookup

`remark-gfm` finds autolink literals by running `mdast-util-find-and-replace` 3.0.2 over every
text node. For each one it looks up the index of every ancestor among its siblings with
`indexOf`, scanning the root's children from the start, so the walk grows quadratically with the
number of top-level blocks, in V8 and JavaScriptCore alike.
[`patches/mdast-util-find-and-replace+3.0.2.patch`](../../patches/mdast-util-find-and-replace+3.0.2.patch)
resumes each lookup at the index last found in the same `children` and changes nothing else.

`tests/find-and-replace-index.test.ts` checks the installed version and the patched lookups, and
that the parser reproduces trees recorded from the unpatched package. Upstream 3.0.4 removes the
lookup by taking indexes from `unist-util-visit-parents` 6.1, but 3.0.3 also merges adjacent text
nodes, which changes the trees; adopting it needs its own review of the reading tree.
