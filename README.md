# mastermind

Review Markdown with your coding agent, in a local desktop app.

Your agent writes a plan, a design, or a draft as a Markdown file and opens it in mastermind. You
read it like a document, comment on passages, and propose changes. Every mark is written into the
same file as [CriticMarkup](http://criticmarkup.com/), so the agent reads your feedback by rereading
the file, replies in place, and resolves discussions there. There is no account, server, database,
or sync: the file on disk is the whole channel.

mastermind is maintained by [Da Wei](https://github.com/d4wei) and based on Kevin Ding's
[Mastermind](https://github.com/Jingquank/Mastermind) v0.2.1 at `3687c91`, under the
[MIT license](LICENSE).

## How a review goes

1. The agent opens the files it wants reviewed:

   ```sh
   node /path/to/mastermind/bin/mastermind.js open -- plan.md "design notes.md"
   ```

2. You read in mastermind. Select text to comment or to suggest a change; accept or reject the
   agent's proposed edits. Edits save continuously.
3. Ask the agent to continue. It rereads the file, answers each discussion with a signed reply, and
   resolves what is settled. Resolved history stays in the file, hidden from reading.

The [bundled skill](.claude/skills/mastermind/SKILL.md) teaches an agent the whole loop, and
[agent setup](assets/agent/README.md) shows how to install it. The
[review protocol](.claude/skills/mastermind/reference/review-protocol.md) defines the in-file
feedback format.

## Why a file

- **Byte-exact.** Opening and saving an unedited file reproduces it exactly, line endings included.
  Accepting or rejecting a mark splices the source; nothing is re-rendered.
- **Nothing reaches disk without you.** Agent suggestions render on screen until you accept them.
- **No lock-in.** CriticMarkup is plain text. Any editor shows it, Git diffs it, and an agent reads
  it without a tool.
- **Local only.** The desktop app talks to nothing beyond the machine it runs on.

## Install from source

Install Node 20+, Rust, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
for your operating system. macOS is the primary platform; Windows and Linux package checks and the
remaining release gaps are recorded in [native validation](tools/desktop/results.md). Public
packaging and an installed command are not yet decided, so the repository launcher is the way in.

```sh
git clone https://github.com/d4wei/mastermind.git
cd mastermind
npm ci
npm ci --prefix tools/desktop
npm run desktop:build
node bin/mastermind.js open -- plan.md
```

The macOS build creates `desktop/target/release/bundle/macos/mastermind.app`. The first launch asks
for your name and Interface language; files opened during setup stay open afterward. Builds are not
signed or notarized.

## Reading and reviewing

- **Read and Markdown.** `Cmd+E` switches between the rendered document and its source. Read shows
  insertions, deletions, substitutions, highlights, and author-tagged discussions; Markdown edits
  the original text with CodeMirror.
- **Comment or suggest.** Select text to comment or to propose replacement text; clearing the
  replacement proposes deletion. Delete removes one comment; Resolve archives the discussion,
  visible through Resolved discussions. `Cmd+Z` undoes review actions.
- **Find.** `Cmd+F` searches the displayed document and its comments, a translation, or the full
  source, depending on the mode.
- **External changes.** A clean document reloads changes from disk automatically. A document with
  unsaved edits pauses and offers Use incoming or Save As…, so neither version is lost. The
  [native file contract](desktop/src/files.md) describes concurrency and filesystem limits.
- **Closing.** Closing waits for saves. A failed save keeps the text recoverable and blocks the
  close.

Themes, fonts, text width, and code colors live in Settings. The
[design system](themes/README.md) explains the theme contract, and
[product terminology](docs/terminology.md) lists the English and Chinese labels.

## Translated reading

An agent can prepare translations of a document so you can read it in another language while
feedback stays in the original file. Choose a prepared version from the document's Reading
language menu; Original always opens first. Comments made on a translated passage keep the quoted
translation and anchor to the original block. Changes to prose invalidate a translation; comments
and resolved history do not. Preparation is a standalone Node utility:

```sh
node bin/mastermind.js translate-blocks plan.md --source-lang en --target-lang zh-CN
node bin/mastermind.js translate-blocks plan.md \
  --source-lang en --target-lang zh-CN --save < ready.json
```

Artifacts live in `.mastermind/translations/` beside the document; keep that directory out of
version control.

## Develop

```sh
npm run dev            # native app with a hot-reloading interface
npm test               # application and tooling tests
npm run typecheck      # browser and Node configurations
npm run desktop:build  # native macOS app
```

The [desktop host](desktop/README.md) describes the native build, the development server, and
platform commands. The [source map](docs/source-map.md) is the implementation guide, and
[DECISIONS.md](DECISIONS.md) and [DIRECTION.md](DIRECTION.md) record settled constraints and
open questions. Use a disposable copy of
[the manual review document](tests/manual/review-interactions.md) for visual checks.
