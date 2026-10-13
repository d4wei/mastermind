# Agent setup

mastermind reviews existing Markdown files. The app saves edits continuously, and the agent reads
feedback from those same files when the person asks it to continue. Opening a document returns
immediately; there is no hand-back signal, generated completion summary, or translation listener.

## Install the public skill

Make [the mastermind skill](../../.claude/skills/mastermind/SKILL.md) and its `reference/` directory
available through your harness's normal skill installation mechanism. The `master` alias is
optional. The skill and its reference files contain the complete review instructions.

For a project that uses mastermind to review plans, an instruction can be as small as:

```markdown
Write plans to Markdown files and open them with the mastermind skill for review. When I ask you
to address feedback, reread the current file and follow the skill's public review protocol.
```

## Open and prepare

`node /path/to/mastermind/bin/mastermind.js open -- FILE...` opens the original without waiting
for translation. Build the source checkout with `npm run desktop:build` first. A bare skill request
lets the session agent choose which files need review; explicit paths take precedence. Pass the
chosen paths together; each receives an admission result. People can configure appearance, their
name, and the optional translation
language in Settings; they do not need to operate the CLI.

The preparing agent supplies complete, fresh translations when wanted. It reads the whole document
and uses its existing context. `translate-blocks` emits the preparation inputs with explicit source
and target languages; `--save` validates and replaces the complete prepared artifact. The commands
and public protocol are maintained with the bundled skill:

- [Preparation instructions](../../.claude/skills/mastermind/SKILL.md)
- [Review protocol](../../.claude/skills/mastermind/reference/review-protocol.md)

A translation artifact is a disposable reading aid. Feedback, including quoted passages selected
from translations, belongs in the original Markdown file. Clean buffers reload external changes;
dirty buffers retain both versions and pause saving for explicit comparison. The file-write limits
are documented in the source checkout at `src-tauri/src/files.md`.
