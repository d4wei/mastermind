# Product purpose

mastermind is a local Markdown reviewer for people working with coding agents. A reviewer reads a
plan or other document, edits its source, and leaves comments or proposed changes as CriticMarkup.
The agent reads and responds in that same file. Review does not require an account, remote service,
or separate discussion store.

## Review experience

The document is the primary surface. Typography, reading measure, and margin comments support
focused review; navigation and controls should leave room for the text. The
[theme contract](../themes/README.md) defines the visual system. Review colors distinguish proposed
insertions, deletions, highlights, and comment anchors from ordinary prose.

Read and Markdown views share one document buffer. Accepting or rejecting a mark changes its exact
source span. Edits save continuously; a reviewer can work across files without a separate completion
action for each one. People and agents can both contribute author-tagged replies. Resolved
conversations remain as hidden history in the Markdown file; deleting a comment removes it.

Single-language review is complete on its own. For translated reading, the agent preparing a
document can also prepare a translation using its existing context. Opening the original never waits
for translation. Comments made from a translated passage retain the selected quote and language in
the original document. Exact text edits remain anchored to the original source.

## Product boundaries

The app reviews existing files. The invoking agent chooses which files need review; Git changes and
conversation context may inform that judgment. The app does not infer that choice from Git alone.
The public [review skill](../.claude/skills/mastermind/SKILL.md) describes preparation and agent
participation.

Tauri owns native file access and application lifetime while React renders the review interface.
Graphical onboarding confirms Your name and Interface language; native file opening retains
documents admitted during setup. Development runs the same native host against a hot-reloading
interface. Signing and public distribution identity remain separate from adopting the native
application.

## Authoritative references

- [README](../README.md): installation and current usage.
- [Review protocol](../.claude/skills/mastermind/reference/review-protocol.md): in-file feedback.
- [Implementation map](source-map.md): source modules and their contracts.
- [Decisions](../DECISIONS.md): settled constraints.
- [Native validation](../tools/desktop/results.md) and [direction](../DIRECTION.md): release gaps
  and unresolved choices.
- [Project origins](fork-rationale.md): design rationale inherited from upstream Mastermind.
