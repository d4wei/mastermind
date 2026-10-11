# src/

Three layers, each with its own tsconfig, over one shared core.

- **`cli/`** — the `mastermind` command (commander). A thin client: `daemon.ts` ensures one shared
  background daemon is running, then everything goes over HTTP (`http.ts`) and SSE (`sse.ts`).
  `wait.ts` implements the `--wait` and `--serve-assist` blocking loops.
- **`server/`** — a Hono app (`app.ts`) plus daemon lifecycle (`index.ts`: port scan from 5173, idle
  self-exit, statefile under `~/.config/mastermind`). Registries: `sessions.ts` (open files by real
  path), `workspaces.ts` (file-tree roots), `assist/` (agent-as-provider task queue), `translate/`
  (providers and the on-disk cache). `handback.ts` and `snapshots.ts` implement Save & hand back and
  the `.mastermind/history/` rounds; `contain.ts` keeps workspace trees inside their root;
  `watch.ts` (chokidar) drives the file-changed banners.
- **`ui/`** — React 19 + Vite, Zustand stores. Two views over one buffer, toggled with `Cmd+E`:
  Reading (`modes/reading/Renderer.tsx`, rendered Markdown with CriticMarkup as a visual diff) and
  Source (`modes/source/SourceEditor.tsx`, CodeMirror). `review/` holds the comment rail,
  accept/reject, find, rounds, and inline-suggestion proposals.
- **`shared/`** — imported by all three, so it stays browser-safe. `critic/scanner.ts` parses
  CriticMarkup into typed marks; `critic/resolve.ts` accepts or rejects a mark as an exact source
  splice; `critic/mask.ts` and `critic/suggest.ts` back find and suggestions. `markdown/` is the
  remark pipeline that carries CriticMarkup through the AST and back. `blocks.ts`, `edits.ts`,
  `eol.ts`, `summary.ts`, `types.ts`, `constants.ts` hold the block model, EOL preservation, the
  hand-back summary block, and the client–server contract.

The invariants the tests assert — byte-exact round trips (`critic-resolve.test.ts`,
`selection-ranges.test.ts`), marks reaching disk only by user acceptance, workspace containment
(`workspace-contain.test.ts`), tokens-only styling (`theme-token-consistency.test.ts`) — are listed
in the root `AGENTS.md`.
