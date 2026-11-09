# Agent setup

mastermind reviews existing Markdown files. The app saves edits continuously, and the agent reads
feedback from those same files when the person asks it to continue. Opening a document returns
immediately; there is no hand-back signal, generated completion summary, or translation listener.

## Install the public skill

Make [the mastermind skill](../../.claude/skills/mastermind/SKILL.md) and its `reference/` directory
available through your harness's normal skill installation mechanism. The `master` alias is
optional. The skill and its reference files contain the complete instructions: opening and closing
documents, addressing feedback, readying a draft, preparing translations, and prefilling setup.

For a project that uses mastermind to review plans, an instruction can be as small as:

```markdown
Write plans to Markdown files and open them with the mastermind skill for review. When I ask you
to address feedback, reread the current file and follow the skill's public review protocol.
```

## What the skill assumes

The source checkout is built with `npm run desktop:build`, and its dependencies are installed with
`npm ci` before a translation is prepared. People configure appearance, Display name, and Interface
language in Settings and choose a Reading language per document; they do not operate the CLI.

A translation artifact is a disposable reading aid. Feedback, including quoted passages selected
from translations, belongs in the original Markdown file. Clean buffers reload external changes;
dirty buffers retain both versions and pause saving for an explicit recovery choice. The file-write
limits are documented in the source checkout at `desktop/src/files.md`.
