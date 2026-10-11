# Prepared translation artifacts

`planTranslation` emits every translation and context block, plus a translation fingerprint and
explicit source/target language codes. A new pass never filters blocks against an earlier artifact.
The agent translates all translatable blocks and returns the complete versioned artifact described
by `src/shared/translation.ts`.

`savePreparedTranslation` checks the translation fingerprint, language pair, complete IDs, and
CriticMarkup structure before writing. It rereads the document before atomically replacing the
artifact with a unique temporary-file rename. It does not merge previous entries, retain partial
success, or swallow save failures. An unrelated document writer can still change the source after
that final check; this is not an atomic transaction across the document and artifact.

Artifacts live beside their documents at `.mastermind/translations/<basename>.<target-code>.json`.
Language codes are validated before entering filenames. The source Markdown remains untouched;
prepared text is a derived reading artifact, never a store for review feedback.

`readPreparedTranslation` accepts only the current schema and validates again against the supplied
source and requested target. GET `/api/sessions/:id/translation?targetLang=CODE` supplies the
current disk source and returns the artifact, or reports missing (404), stale/invalid (409),
unreadable source (410), or invalid target (400). Browser callers also validate against their
current local buffer.
No read generates text or queues agent work.

The CLI requires both language codes. `translate-blocks FILE --source-lang CODE --target-lang CODE`
emits a fresh plan; adding `--save` consumes the complete artifact JSON on stdin. Review opening is
independent of artifact availability and always returns without a completion wait.
