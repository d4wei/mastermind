---
name: mastermind
description: >-
  Opens Markdown files in the mastermind desktop app for a person to review, prepares translations
  of them, and addresses the review marks the person writes into the files. Use when the user asks
  to open a plan, design, or draft for review, runs /mastermind or /master, hands back a document
  they marked up, asks to address or reply to the comments or suggested edits in a file, or wants a
  translation prepared for reading.
---

# mastermind

The Markdown file carries the document and its review feedback. The app saves the person's marks
into that file as they work; there is no completion signal, so you learn what they said by rereading
the file when they ask you to continue. [The review protocol](reference/review-protocol.md) defines
the marks and what the person expects to happen to each; read it before addressing feedback or
adding marks of your own.

## Open documents

Run the launcher from a mastermind checkout prepared with `npm ci` and `npm run desktop:build`:

```sh
node /path/to/mastermind/bin/mastermind.js open -- plan.md "design notes.md"
```

Open the paths the person named; `/mastermind FILE` with no other request means open it. Given no
paths, choose the Markdown files this conversation produced or changed that the person has not yet
reviewed; Git status and the conversation are inputs to that choice, not the rule. Run the launcher
by its path: a `mastermind` command on PATH may be another program.

`open` starts or reuses the app and prints one JSON result per path: `opened`, `already_open` (a
successful no-op that keeps the person's edits and drafts there), or `error`. It takes at most 64
paths, each ending in `.md` or `.markdown`, a symlink's target included. Exit status is 0 when every
file opened or was already open, 1 when any failed (see its result), 2 for an invalid invocation,
and 3 (`outcome_unknown`) when the reply was lost; retrying after 3 is safe. A file that is not
valid UTF-8 opens with replacement characters, but saving an edit to it is refused (`not_utf8`);
Save As writes a UTF-8 copy. A first open reports `onboarding_needed` while the person confirms
their Display name and Interface language in the app; the files stay admitted.

When you know a document's language and its file has no frontmatter `lang`, pass it with
`--document-language CODE` (a BCP 47 tag such as `zh-TW` or `ko`) so its characters take that
language's glyph forms; the hint is stored nowhere and leaves the file untouched.

## Address feedback

When the person asks you to continue, reread the whole file and every mark in it before changing
anything: a later mark can order a rewrite that removes the text earlier marks are about. Close the
file next, as below, so the person does not keep editing a file you are rewriting; closing saves
their latest edits, so reread once more after it reports `closed`, and run `marks` on it (below) for
the inventory you will work from. Then give each mark, in file order, the treatment the review
protocol promises, and run `marks` again when done: it must exit 0, so repair each delimiter it
reports. Report one table: each mark (its line number from the first inventory, a few words of it),
what was done, one clause of why; a mark removed by another mark's rewrite gets its own row. After
the table come a request the person made alongside the marks, which is theirs to have done, and
anything a rule here told you to list, such as candidate instances or a file that stayed open. Open
the file again when the result needs their eyes, such as answers left standing beside their
questions.

Nothing in the app signals approval: not opening, not saving, not the end of your turn. Only the
person's words do.

## Close reviewed documents

Close a file after rereading it and before editing it:

```sh
node /path/to/mastermind/bin/mastermind.js close -- plan.md
```

Close only files you opened or were asked to address. Other open files may belong to the person or
to another session, and closing one takes it away from them. Each result is `closed`, `not_open`
(already closed, a successful no-op), `blocked` with a `reason`, or `error`. `blocked` means the
person still has work there: an unfinished draft, unsaved edits, a recovery choice, or an app window
that could not answer. Do not override it, and do not edit that file: your changes on disk would
collide with the work the person has in it. Tell them which file stayed open and why. Exit status is
0 when every file is closed or not open, 1 when any is blocked or failed, 2 for an invalid
invocation, and 3 when the reply was lost; retrying after 3 is safe. The app reopens its open files
at its next start, so a file you leave open stays in front of the person across restarts; while the
app is not running, every file reports `not_open`.

## Inventory review marks

`node /path/to/mastermind/bin/mastermind.js marks [--json] FILE...` lists each file's review marks
as the app's own parser reads them, one line per mark in file order: `L<line>:<col>`, kind, author
tag or `@?`, and text, with ` on "anchor"` and ` #n` naming a comment's anchor and discussion.
`--json` prints the same inventory structured. It needs `npm ci`, not a native build. Exit status
is 0 on a clean parse; 1 when a delimiter would show as literal text, naming each on stderr as
`file:L<line>:<col>: message`; and 2 for invalid invocation. The viewer drops such marks silently,
so fix every one before handing a file back.

## Ready a draft for review

When asked to ready a draft of your own before the person reads it, add to it, in the forms the
review protocol gives:

- a comment under your tag for each question you have for the reader;
- a decision item wherever no reasonable default exists and the choice materially changes scope or
  outcome, each carrying a recommendation and its reason: a one-page draft gets a handful, not one
  per section;
- a suggested edit for a concrete change someone proposed, followed directly by a comment under
  your tag naming whose proposal it is.

Change nothing else; a draft meant to collect the person's own edits may need no marks at all.
Then run `marks` on it to confirm each mark parses and lands in the discussion you meant, and open
it.

## Prepare a translation

Prepare translations yourself, in this session, with the document's context; do not hand the work
to another process. The person's request decides the languages, including several or none. Without
one, use the session's language and context to decide whether a translation helps, and open the
original alone when none does. A rejected translation leaves the original available. Editing the
document invalidates its prepared translations; prepare them again before the person reads it in
that language.

For each preparation, translate the complete document afresh, reading it as a whole even though the
output is divided into blocks for display and source anchoring; never fill a preparation with
previously cached block translations. Pass the source language explicitly; a comment written in
another language does not change it.

```sh
node /path/to/mastermind/bin/mastermind.js translate-blocks plan.md \
  --source-lang en --target-lang zh-CN
```

Use the returned version, translation fingerprint (`sourceHash`), languages, and translation block
IDs to form a complete artifact with translated text for every translatable block. Keep one block
per ID, its Markdown kind and heading/list prefixes, and the kinds and order of proposed edits.
Comments, highlights, and resolved history are handled separately from translation input. Write
the artifact to a temporary JSON file using only these fields; include an `{"id", "text"}` entry
for every translatable block:

```json
{
  "version": 1,
  "sourceHash": "the returned sourceHash",
  "sourceLang": "en",
  "targetLang": "zh-CN",
  "blocks": [{"id": "b1", "text": "# 译文标题"}]
}
```

Submit it through stdin, then open the document with its reading version suggested:

```sh
node /path/to/mastermind/bin/mastermind.js translate-blocks plan.md \
  --source-lang en --target-lang zh-CN --save < prepared.json
node /path/to/mastermind/bin/mastermind.js open --language zh-CN -- plan.md
```

Repeat preparation and saving for each target language; artifacts coexist per target. `--save`
writes `.mastermind/translations/<basename>.<lang>.json` beside the resolved document and refuses
when that directory resolves outside the document's folder; keep `.mastermind/` gitignored. The
`--language` hint selects a valid prepared version once; it never changes saved settings or
overrides a reader's existing choice. The app keeps only the first hint per open document and spends
it at that document's next translation discovery, so `--save` before `open --language`.

A changed source or an invalid or incomplete artifact is rejected as a whole. Reread the current
document and prepare again; do not patch identifiers until stale output passes.

## Prefill setup or demonstrate

When the person asks you to prefill their setup, suggest known values with a separate operation:

```sh
node /path/to/mastermind/bin/mastermind.js setup --suggest '{"authorTag":"Reader","uiLang":"en"}'
```

Supported fields are `authorTag` and `uiLang` (`en`, `zh-CN`, `ja`, or `fr`). Suggestions never
overwrite saved choices; people confirm them in the app.

When explicitly asked for a demonstration, adapt `reference/demo.md` into a disposable Markdown
file and open it. Keep the sample marks valid; an optional translation follows the preparation flow
above.
