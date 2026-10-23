# mastermind

Review Markdown with your coding agent in a local desktop app. Read a document, add author-tagged
CriticMarkup comments and proposed edits, and let the agent reread the same file. Edits save
continuously. Discussions, including agent replies and resolved history, stay in the Markdown file.

Maintained by [Da Wei](https://github.com/d4wei), mastermind is based on Kevin Ding's
[Mastermind](https://github.com/Jingquank/Mastermind) v0.2.1 at `3687c91`, under the
[MIT license](LICENSE). Tauri hosts the React interface and native file services. The desktop app
needs no account, database, HTTP server, or Node sidecar.

## Run from source

Install Node 20+, Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
for your operating system. macOS is the primary development platform. Windows and Linux package
checks and remaining release gaps are recorded in [native validation](tools/desktop/results.md).

```sh
git clone https://github.com/d4wei/mastermind.git
cd mastermind
npm ci
npm ci --prefix tools/desktop
npm run desktop:build
node bin/mastermind.js open -- plan.md
```

The macOS build creates `desktop/target/release/bundle/macos/mastermind.app`. Open files through
the app's native picker or the repository launcher. The first launch asks for your name and
Interface language. Files opened during setup remain available afterward.

Public packaging and installed command identity remain undecided; the npm project is private and
the native identifier remains provisional. Platform build commands live in
[the desktop host](desktop/README.md). The [bundled skill](.claude/skills/mastermind/SKILL.md) and
[agent setup](assets/agent/README.md) describe invoking the source checkout.

## Review

`Cmd+E` switches between Read and Markdown. Read shows insertions, deletions, substitutions,
highlights, and author-tagged discussions. Markdown edits the original text. Accepting or rejecting
a mark splices the source rather than serializing a rendered document.

The magnifying-glass button or `Cmd+F` / `Ctrl+F` opens Find. Search the displayed document and
comments in Read, the displayed translation in translated reading, or the full source in Markdown.
Enter and Shift-Enter move between occurrences; Escape closes the floating panel.

Select original text to comment or suggest a change; clearing the replacement suggests deletion.
Agents may append a signed reply to a discussion. Delete removes one comment; Resolve archives the
discussion at the file tail, visible through Resolved. `Cmd+Z` undoes review actions.

A clean buffer reloads external changes automatically. A dirty buffer keeps local edits, pauses
editing, and offers Use incoming, which discards them, or Save As, which writes them to a new file.
The [native file contract](desktop/src/files.md) describes concurrency and filesystem limits.
Closing the app waits for saves; failures retain recoverable text and block the close.

## Optional translated reading

Use the document's Reading language menu to choose among prepared translations. The preparing
agent chooses useful languages from session context; explicit requests override that choice,
including requests for several languages or none. Original always opens immediately. The app
checks translation freshness and writes review feedback into the original Markdown file.

Comments, highlights, and resolved history do not invalidate a translation. Changes to prose or
proposed edits do. A stale or missing translation falls back to the original. Comments on translated
passages anchor to the original block and preserve the selected translation and its language.
Exact text edits remain on the original document. Discussion stays in its authored language.
See the [public review protocol](.claude/skills/mastermind/reference/review-protocol.md).

## Agent commands

Use the repository launcher with its absolute path when invoking it from another working directory:

```sh
node bin/mastermind.js open -- plan.md "design notes.md"
node bin/mastermind.js setup --suggest '{"authorTag":"Reader","uiLang":"en"}'
npm run build
node bin/mastermind.js translate-blocks plan.md --source-lang en --target-lang zh-CN
node bin/mastermind.js translate-blocks plan.md \
  --source-lang en --target-lang zh-CN --save < ready.json
```

Opening reports each file's admission result and returns without waiting for review completion.
Setup suggestions are transient; people confirm them graphically. Translation preparation is a
standalone Node utility and never starts the app or a server. Its save operation validates and
replaces a complete artifact under `.mastermind/translations/` beside the document; keep that
directory out of version control. The [bundled skill](.claude/skills/mastermind/SKILL.md) lists path
limits, exit statuses, and the opening-hint order. People do not need to operate these commands
themselves.

## Develop

```sh
npm run dev            # native app with a hot-reloading interface
npm test               # application and tooling tests
npm run typecheck      # browser and Node configurations
npm run build          # translation utility
npm run desktop:build  # native macOS app
```

`npm run dev` runs `tauri dev` through the pinned CLI, which `npm ci --prefix tools/desktop`
installs. It serves `ui/desktop.html` with Vite on port 5173, then builds and opens the debug host.
Interface edits apply through hot module replacement; Rust edits rebuild and relaunch the host.
Open files with the Open button, or from a second shell with `node bin/mastermind.js open -- FILE`,
which hands them to the running host. Ctrl-C stops both.

The development host claims the same per-user endpoint as the installed app. Quit mastermind before
`npm run dev`; otherwise the development host exits at once and stops the session with it. A debug
binary always loads its interface from the development server, so it shows an interface only while
`npm run dev` is running; `npm run desktop:build` produces the standalone app.

The implementation map is in [the source map](docs/source-map.md). Theme tokens are defined in
[themes/README.md](themes/README.md), and accepted English and Chinese labels are in
[Product terminology](docs/terminology.md). Use a disposable copy of
[the manual review document](tests/manual/review-interactions.md) for visual checks.
