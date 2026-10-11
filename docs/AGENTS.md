# docs/

- Put depth here only when it has no closer home beside the code; use this directory primarily for
  self-contained designs and plans for work not yet built.
- Name human-facing documents in lowercase-kebab form, such as `<topic>.md`; reserve ALL-CAPS names
  for agent-operating docs and canonical project ledgers.
- Start every living forward design with this frontmatter:

```
---
status: living   # living | frozen | append-only | historical
updated: YYYY-MM-DD
exit: <the condition on which this design graduates and is deleted>
---
```

- Move `updated` on every substantive edit.
- When the work ships, move its durable contract into the code and colocated docs, then delete the
  design.
- Declare frozen material at birth and never edit it. Put corrections in a new versioned file with
  an amendment note.
- For append-only or historical material, declare the status and its mutation rule in the opening
  paragraph.
- Keep every status and verdict in one authoritative file; make other documents point to it or carry
  a dated vintage stamp.
