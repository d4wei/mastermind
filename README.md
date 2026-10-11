# Mastermind

Review Markdown with your coding agent. Read a document, add author-tagged CriticMarkup comments
and proposed edits, and let the agent reread the same file. Edits save continuously. Discussions,
including agent replies and resolved history, stay in the Markdown file.

Maintained by [Da Wei](https://github.com/d4wei), Mastermind is based on Kevin Ding's
[Mastermind](https://github.com/Jingquank/Mastermind) v0.2.1 at `3687c91`, under the
[MIT license](LICENSE). It currently runs in a desktop browser with local file services; the planned
Tauri desktop host will replace that runtime. Install from this repository using the instructions
below.

## Run from source

Node 20+ and a desktop browser are required. macOS is the current development platform.

```sh
git clone https://github.com/d4wei/mastermind.git
cd mastermind
npm install
npm run build
node bin/mastermind.js open plan.md
```

Use `npm link` if you want the `mastermind` command on your PATH. Agents can use the
[bundled skill](.claude/skills/mastermind/SKILL.md); [agent setup](assets/agent/README.md) describes
installation and the file-based review flow. No account, database, or remote service is required.

## Review

`Cmd+E` switches between Reading and Source. Reading shows Markdown with insertions, deletions,
substitutions, highlights, and author-tagged discussions. Source edits the original Markdown.
Accepting or rejecting a mark splices the source rather than serializing a rendered document.

Select original text to comment, highlight it, or suggest deletion. Agents may answer questions by
appending a signed comment to the same thread. Delete removes one comment; Resolve archives the
complete discussion at the file tail, visible through Resolved. `Cmd+Z` undoes review actions.

A clean buffer reloads external changes automatically. A dirty buffer keeps local edits and the
disk version, pauses saving, and offers an explicit comparison with an editable result. The
[file service contract](src/server/files.md) describes the concurrency and filesystem limits.

## Optional comfort-language reading

Choose a comfort language in Settings when you want translated reading. The same agent preparing
the document supplies a fresh complete translation for each preparation pass, using its existing
context. The app reads that local artifact; it does not run a translation service or wait for an
agent. Opening the original always works without a translation.

Comments, highlights, and resolved history do not invalidate the narrative translation. Changes to
prose or proposed edits do. A stale or missing translation falls back to the original. Select a
translated passage to comment against its original block; the comment preserves the selected
translation and its language. Exact text edits remain on the original document.

Discussion stays in its authored language. All feedback lives in the original Markdown file; the
translation artifact contains no exclusive review state. See the
[public review protocol](.claude/skills/mastermind/reference/review-protocol.md).

## Settings

Settings controls appearance, author tags, and the optional personal comfort language. Theme tokens
keep the document surface quiet and reserve review colors for marks. Preferences remain in
`~/.config/mastermind/config.json` during the desktop transition.

```sh
mastermind config get
mastermind config set comfortLang=zh-CN theme=sepia
```

## Agent commands

```sh
mastermind open plan.md
mastermind translate-blocks plan.md --source-lang en --target-lang zh-CN
mastermind translate-blocks plan.md --source-lang en --target-lang zh-CN --save < prepared.json
```

Open returns immediately. Preparation emits the complete translation inputs; save validates and
replaces a complete artifact, never merges old block translations. Language codes are explicit.
People can use the app through their agent without operating these commands themselves.

The existing `new`, `workspace`, `install-agents` / `uninstall-agents`, and `status` / `stop`
commands remain during the transition. Their planned replacement or removal is described in the
[architecture review](docs/architecture-review.md); they are not prerequisites for ordinary review.

## Develop

```sh
npm run dev        # local file service and Vite development UI
npm test           # full suite
npm run typecheck  # browser and Node configurations
npm run build      # required before invoking the bin from a clone
```

Run one test file with `npx vitest run tests/critic-scanner.test.ts`. The implementation map is in
[src/README.md](src/README.md), and the theme contract is in [themes/README.md](themes/README.md).
Use a disposable copy of [the manual review exercise](tests/manual/review-interactions.md) to check
callouts and selections across blocks in the browser.
