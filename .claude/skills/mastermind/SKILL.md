---
name: mastermind
description: >-
  Open Markdown documents for review, optionally prepare comfort-language translations,
  and address author-tagged feedback written into the files.
---

# Mastermind

The Markdown file carries the document and its review feedback. The app saves edits continuously;
there is no completion signal to wait for. Read [the review protocol](reference/review-protocol.md)
before preparing marks or addressing feedback.

## Choose and open documents

Use explicitly requested paths. With no paths, choose the Markdown files needing review from the
current conversation and working tree. File selection belongs to your judgment; Git is optional,
and neither all uncommitted files nor the most recently edited file is a mandatory rule.

Run `mastermind open <file>` for each chosen file. It opens immediately and returns its URL.
Translation is optional and never prevents opening the original. When the person returns with
feedback, reread the files before changing them; do not infer approval from the command returning.

## Prepare a comfort-language translation

The agent preparing the document also prepares its translations using the document's context.
Do not start a translation listener or delegate to a separate translator. Use the user's requested
comfort language; `mastermind config get` exposes the optional personal `comfortLang` preference.
If none is requested or configured, open the original without translation. The source language is
explicitly supplied by you; it is not inferred from the language of a newly added comment.

For each preparation pass, translate the complete document afresh. Read it as a whole, including
relevant context, even though the output is divided into blocks for display and source anchoring.
Never fill a new preparation with previously cached block translations.

```sh
mastermind translate-blocks plan.md --source-lang en --target-lang zh-CN
```

Use the returned version, source hash, languages, and block IDs to form a complete artifact with
translated text for every translatable block. Keep one block per ID, its Markdown kind and
heading/list prefixes, and the kinds and order of proposed edits. Comments, highlights, and resolved
history are handled separately from narrative translation. Write the artifact to a temporary JSON
file using only these fields; include an `{"id", "text"}` entry for every translatable block:

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
mastermind translate-blocks plan.md --source-lang en --target-lang zh-CN --save < prepared.json
mastermind open plan.md
```

A changed source or invalid/incomplete artifact is rejected as a whole. Reread the current document
and prepare again; do not patch identifiers until stale output passes. Translation failures leave
the original available. The app reads prepared artifacts and never requests generation itself.

## Optional setup and demonstration

Use `mastermind config get` to inspect existing preferences and `mastermind config set` to apply
requested changes. Do not force a setup questionnaire before opening a file. People can change
appearance, their author tag, and their comfort language in Settings.

When explicitly asked for a demonstration, adapt `reference/demo.md` into a disposable Markdown
file and open it. Keep the sample marks valid; optional translation follows the same preparation
flow. Installation belongs to the invoking harness: make this skill and its reference files
available using that harness's ordinary skill installation mechanism.
