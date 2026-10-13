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

## Prepare a translation

The agent preparing the document also prepares its translations using the document's context.
Do not start a translation listener or delegate to a separate translator. Use the user's requested
translation language from the request or known session context. If none is known, open the original
without translation. Supply the source language explicitly; do not infer it from the language of a
newly added comment.

Build the standalone utility with `npm run build` in the checkout before preparation.
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
node /path/to/mastermind/bin/mastermind.js open -- plan.md
```

A changed source or invalid/incomplete artifact is rejected as a whole. Reread the current document
and prepare again; do not patch identifiers until stale output passes. Translation failures leave
the original available. The app reads prepared artifacts and never requests generation itself.

## Optional setup and demonstration

Opening reports `onboarding_needed`; the app retains admitted files while people confirm setup.
When requested, suggest known values with a separate operation:

```sh
node /path/to/mastermind/bin/mastermind.js setup --suggest '{"authorTag":"Reader","uiLang":"en"}'
```

Supported fields are `authorTag`, `uiLang` (`en` or `zh-CN`), and `translationLanguage` (a language
code or null for Original only). Suggestions are transient and cannot overwrite saved or actively
edited choices. Do not force a questionnaire before opening. People confirm their Name and language
choices graphically and change them later in Settings.

When explicitly asked for a demonstration, adapt `reference/demo.md` into a disposable Markdown
file and open it. Keep the sample marks valid; optional translation follows the same preparation
flow. Installation belongs to the invoking harness: make this skill and its reference files
available using that harness's ordinary skill installation mechanism.
