# Agent setup

Mastermind reviews existing Markdown files. The app saves edits continuously, and the agent reads
feedback from those same files when the person asks it to continue. Opening a document returns
immediately; there is no hand-back signal, generated completion summary, or translation listener.

## Install the public skill

Make [the Mastermind skill](../../.claude/skills/mastermind/SKILL.md) and its `reference/` directory
available through your harness's normal skill installation mechanism. The `master` alias is
optional. The skill is self-contained and works without any private plugin.

The app's existing `install-agents` and `uninstall-agents` commands remain available during the
browser-to-desktop transition. They copy skills and add or remove a marked global instruction block;
run `mastermind uninstall-agents` to remove those copies and marked blocks. It removes the
`mastermind` and `master` skill directories, including local edits; retain any edits you need first.
Future installation belongs to the harness, rather than app-owned directory detection.

For a project that uses Mastermind to review plans, an instruction can be as small as:

```markdown
Write plans to Markdown files and open them with the Mastermind skill for review. When I ask you
to address feedback, reread the current file and follow the skill's public review protocol.
```

## Open and prepare

`mastermind open <file>` opens the original without a translation prerequisite. A bare skill request
lets the session agent choose which files need review; explicit paths take precedence. Repeat open
for each chosen file. People can configure appearance, author tags, and the optional comfort
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
are documented in the source checkout at `src/server/files.md`.
