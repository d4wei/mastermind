---
name: mastermind
description: >-
  Open Markdown documents for review, optionally prepare translations,
  and address author-tagged feedback written into the files.
---

# mastermind

The Markdown file carries the document and its review feedback. The app saves edits continuously;
there is no completion signal to wait for. Read [the review protocol](reference/review-protocol.md)
before preparing marks or addressing feedback.

## Choose and open documents

Use explicitly requested paths. With no paths, choose the Markdown files needing review from the
current conversation and working tree. File selection belongs to your judgment; Git is optional,
and neither all uncommitted files nor the most recently edited file is a mandatory rule.

Use the repository launcher: `node /path/to/mastermind/bin/mastermind.js open -- FILE...`.
It starts or reuses the native app and reports each file's admission result as JSON. It does not
wait for review completion. The checkout must be built with `npm run desktop:build` first.
Installed command identity is not yet configured; do not assume a global `mastermind` command
belongs to this application. Translation never prevents opening the original. When the person
returns with feedback, reread the files; do not infer approval from admission.

One `open` accepts at most 64 paths. Each given path and, for a symlink, its target must end in
`.md` or `.markdown`. Exit status is 0 on full success, 1 when any file failed (see its result), 2
for invalid invocation, and 3 (`outcome_unknown`) when the reply was lost; admission is idempotent,
so retrying after 3 is safe. A file that is not valid UTF-8 opens with replacement characters, but
saving any edit to it is refused (`not_utf8`); Save As writes a UTF-8 copy.

## Close reviewed documents

When the person hands documents back to you, reread them, then close the ones you opened or were
asked to address so the person does not keep editing a file you are rewriting:
`node /path/to/mastermind/bin/mastermind.js close -- FILE...`. Never close other open files; they
may belong to the person or another session. Each result is `closed`, `not_open` (already closed;
closing is idempotent), `blocked` with a `reason`, or `error`. `blocked` means the person still has
work there: an unfinished draft, unsaved edits, a recovery choice, or a reader that could not
answer. Do not override it; tell the person which file stayed open and why. Exit status is 0 when
every file is closed or not open, 1 when any is blocked or failed, 2 for invalid invocation, and 3
when the reply was lost.

## Prepare a translation

The agent preparing the document also prepares its translations using the document's context.
Do not start a translation listener or delegate to a separate translator. Explicit user requests
override your discretion, including requests for several languages or no translation. Otherwise
use the active session's language and context to decide whether translation helps and which
languages to prepare. If none is useful, open the original. Supply the source language explicitly;
do not infer it from the language of a newly added comment.

Install the checkout's dependencies with `npm ci` before preparation.
For each preparation pass, translate the complete document afresh. Read it as a whole, including
relevant context, even though the output is divided into blocks for display and source anchoring.
Never fill a new preparation with previously cached block translations.

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

Submit it through stdin:

```sh
node /path/to/mastermind/bin/mastermind.js translate-blocks plan.md \
  --source-lang en --target-lang zh-CN --save < prepared.json
node /path/to/mastermind/bin/mastermind.js open --language zh-CN -- plan.md
```

Repeat preparation and saving for each requested target language. Artifacts coexist per target.
`--save` writes `.mastermind/translations/<basename>.<lang>.json` beside the resolved document and
refuses when that directory resolves outside the document's folder; keep `.mastermind/` gitignored.
The optional `--language` opening hint selects a valid prepared version once; it never changes saved
settings or overrides a reader's existing choice. The app keeps only the first hint per open
document and spends it at that document's next translation discovery, so `--save` before
`open --language`. The menu also lets readers choose Original.

A changed source or invalid/incomplete artifact is rejected as a whole. Reread the current document
and prepare again; do not patch identifiers until stale output passes. Translation failures leave
the original available. The app reads prepared artifacts and never requests generation itself.

## Optional setup and demonstration

Opening reports `onboarding_needed`; the app retains admitted files while people confirm setup.
When requested, suggest known values with a separate operation:

```sh
node /path/to/mastermind/bin/mastermind.js setup --suggest '{"authorTag":"Reader","uiLang":"en"}'
```

Supported fields are `authorTag` and `uiLang` (`en` or `zh-CN`). Suggestions are transient and
cannot overwrite saved or actively edited choices. Do not force a questionnaire before opening.
People confirm Your name and Interface language graphically and change them later in Settings.

When explicitly asked for a demonstration, adapt `reference/demo.md` into a disposable Markdown
file and open it. Keep the sample marks valid; optional translation follows the same preparation
flow. Installation belongs to the invoking harness: make this skill and its reference files
available using that harness's ordinary skill installation mechanism.
