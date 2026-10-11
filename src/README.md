# src/

CLI, server, and UI layers over one shared core; two tsconfigs check browser and Node code.

- **`cli/`** — the `mastermind` command (commander). A thin client: `daemon.ts` ensures one shared
  background daemon is running; file operations use HTTP (`http.ts`). Opening returns immediately.
  Translation preparation publishes complete artifacts without a live agent service.
- **`server/`** — a Hono app (`app.ts`) plus daemon lifecycle (`index.ts`: port scan from 5173, idle
  self-exit, statefile under `~/.config/mastermind`). Registries: `sessions.ts` (open files by real
  path) and `workspaces.ts` (file-tree roots). `translate/prepared.ts` validates and publishes
  prepared reading artifacts; its contract lives in `translate/prepared.md`. `files.ts` owns
  versioned reads and writes; its contract lives
  in `server/files.md`. `contain.ts` keeps workspace
  trees inside their root; `watch.ts` (chokidar) reports external file changes.
- **`ui/`** — React 19 + Vite, Zustand stores. Two views over one buffer, toggled with `Cmd+E`:
  Reading (`modes/reading/Renderer.tsx`, rendered Markdown with CriticMarkup as a visual diff) and
  Source (`modes/source/SourceEditor.tsx`, CodeMirror). `review/` holds the comment rail,
  accept/reject, find, and inline-suggestion proposals. `app/store.ts` owns buffers and saves;
  `app/store.md` describes their lifetime, conflict comparison, and concurrency boundaries.
- **`shared/`** — imported by all three, so it stays browser-safe. `critic/scanner.ts` parses
  CriticMarkup into typed marks; `critic/resolve.ts` accepts or rejects a mark as an exact source
  splice; `critic/mask.ts` and `critic/suggest.ts` back find and suggestions. `markdown/` is the
  remark pipeline that carries CriticMarkup into the reading AST; saves splice the source string.
  `review-archive.ts` implements comment deletion and resolution; `review-archive.md` defines the
  hidden in-file record. `translation.ts` validates prepared snapshots and encodes translated-view
  comments; `translation.md` describes freshness and source mapping. `blocks.ts`, `edits.ts`,
  `eol.ts`, `types.ts`, and `constants.ts` hold segmentation, source edits, EOL preservation, and
  client–server contract.

The invariants the tests assert — byte-exact round trips (`critic-resolve.test.ts`,
`selection-ranges.test.ts`), marks reaching disk only by user acceptance, workspace containment
(`workspace-contain.test.ts`), tokens-only styling (`theme-token-consistency.test.ts`) — are listed
in the root `AGENTS.md`.
