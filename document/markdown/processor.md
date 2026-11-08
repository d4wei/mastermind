# Markdown parser patch

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
