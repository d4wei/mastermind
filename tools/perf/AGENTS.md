# tools/perf — agentic rules

- Run one bench at a time on an otherwise idle machine; never alongside another bench, `npm test`,
  or a build. Report numbers with the commit the bench prints.
- Run `npm run desktop:build` before `perf:app*`; the harness measures whatever bundle sits under
  `desktop/target/release`.
- Never commit `fixtures/`, `.build/`, `.runs/` or `results/`.
- Treat a fixture hash mismatch as a broken comparison: fix the generator, or change it on purpose
  and start a new audit series in `baselines.json`.
- Add each audit to `baselines.json` as a new `audits` entry with its before and after commits;
  never rewrite a past entry.
- Keep the suite out of `npm test`; add each new bench as its own `perf:*` script.
