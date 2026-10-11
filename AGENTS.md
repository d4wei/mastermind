# mastermind — agentic rules

- Style this application as `mastermind`; use `Mastermind` for the original project.
- Record settled rulings in [`DECISIONS.md`](DECISIONS.md).
- Record open questions and deferrals in [`DIRECTION.md`](DIRECTION.md).
- Put forward designs under [`docs/`](docs/).

## Agentic docs

- Keep each `AGENTS.md` to standing instructions that govern its directory subtree; every line is
  recurring context and must change agent behavior.
- Put each instruction in the lowest `AGENTS.md` whose directory covers all work it governs.
- Create a lower-level `AGENTS.md` when a subtree needs rules that should not burden unrelated work.
- Read the `AGENTS.md` of any directory whose machinery you operate. A lower sheet says how to
  operate its subtree's machinery, never what the machinery must do.
- Do not enumerate lower sheets in this file; the placement convention above is the map, and path
  pointers rot.
- Create a parallel `CLAUDE.md` beside every `AGENTS.md`; begin it with `@AGENTS.md`, then add only
  verified Claude-specific instructions.
- Put agent-only operating instructions in `AGENTS.md`; put mixed-audience explanations in
  `README.md`.
- Use ALL-CAPS filenames for agent-operating docs and canonical project ledgers. Keep human-facing
  design and reference docs lowercase-kebab; treat `README.md` as the conventional exception.

## The product's invariants

The tests enforce these; a change that needs one relaxed is a `DECISIONS.md` ruling first.

- The file on disk is the single source of truth and the only channel: no database, no sync, no
  accounts, no network beyond localhost. Review feedback round-trips through the file as
  CriticMarkup.
- Opening and saving an unedited file reproduces it byte for byte, line endings included; accepting
  or rejecting a mark is an exact source splice, never a re-render.
- Nothing reaches disk without the user's acceptance: agent and assist suggestions render on screen
  only.
- A workspace tree never lists or follows a path outside its root.
- `src/shared/` is imported by the CLI, the server, and the browser; keep it isomorphic.
- Components reference `var(--*)` only; colors and spacing live in `themes/*/tokens.css`, whose
  token names `themes/README.md` fixes. Review marks are the only color in the document body.

## Working the code

- `npm run typecheck` runs both tsconfigs; both must pass. `npm test` before every commit.
- `npm run build` before running `bin/mastermind.js` from a clone; the bin refuses without `dist/`.
- Touch `src/shared/critic/` only with the corpus tests green; it is the most test-covered code.
- Plan in a `.md` file and review it through mastermind itself (`node bin/mastermind.js open
  <plan>.md`; optional translation preparation is in `assets/agent/README.md`). Reread the file
  when the user returns with feedback, and revise it directly.

## Code quality

### Documentation waterfall

- Make code self-documenting first through explicit names, types and interfaces, focused units, and
  enforced invariants.
- Use durable functional names; keep build order, workstreams, and temporary codenames out of paths,
  identifiers, and emitted keys.
- Add comments only for durable, non-obvious rationale and invariants that code cannot express.
- Put longer explanation in a sidecar beside the code it governs; use a directory `README.md` only
  for directory-level orientation.
- Keep overview docs as maps to authoritative code and colocated docs; do not copy their contracts.
- Make project descriptions understandable without the development conversation. Name or link
  necessary referents; keep private team labels and temporary workstream framing out of product
  copy.

### Inline comment hygiene

- Assert only what the code enforces. Put measurements and exact values in the constants, goldens,
  manifests, or tests that assert them; state only the invariant in prose.
- Describe tests and gates as checking, showing, or asserting; never claim they prove or guarantee.
- Add only durable, non-obvious information. Do not restate the construct, sell its merits, or
  preserve incidents and session codes.
- Keep one altitude per comment run and flow from overview to detail.
- Explain each intentional future-facing guard: state why it exists and which rule it enforces if
  the impossible case arrives.

### Change bar

- Add tests for every behavior change.
- Research existing libraries before building new machinery. Pin every adopted dependency
  reproducibly and test the behavior the project relies on.

## Committing work

Commit after a coherent arc of work lands. Before each commit:

1. Audit comment hygiene across the changed code and update comments that fail the rules above.
2. Update directly coupled module docs, rule-site comments, sidecars, and contradicting claims.
3. Scope the commit with `git commit -o <paths>` whenever parallel sessions may share the checkout;
   `git add -N` new files first, since `-o` sees only tracked paths.
4. Write the title as `area: what changed` or `area(sub-area): what changed`, at most 72 characters.
5. Keep each body point on one unwrapped line and sign with a `Co-Authored-By` footer.

```
area(sub-area): what changed

Why this change, and what it does — one unwrapped point per line; the viewer soft-wraps it.

Co-Authored-By: Name <email>
```

Add a terse `DECISIONS.md` entry when the change settles a constraint that binds future work; keep
the constraint there and the implementation story in the commit.
