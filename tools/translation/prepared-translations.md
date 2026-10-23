# Prepared translation artifacts

`planTranslation` emits every translation and context block, plus a translation fingerprint and
explicit source/target language codes. A new pass never filters blocks against an earlier artifact.
The agent translates all translatable blocks and returns the complete versioned artifact described
by `document/translation.ts`.

`savePreparedTranslation` checks the translation fingerprint, language pair, complete IDs, and
CriticMarkup structure before writing. It rereads the document before atomically replacing the
artifact with a unique temporary-file rename. It does not merge previous entries, retain partial
success, or swallow save failures. It checks each segment of `.mastermind/translations` beside the
document's real folder without following links, creating a missing segment only after its parent
passed, and refuses to save when a segment is a link, so nothing is created outside the folder.
Each segment's on-disk name must be exactly `.mastermind` and `translations`; a case variant on a
case-insensitive volume is refused, as `desktop/src/translations.rs` refuses it, so the CLI never
writes where the app will not read. An unrelated document writer can still change the source after
that final check; this is not an atomic transaction across the document and artifact.

Artifacts live beside their documents at `.mastermind/translations/<basename>.<target-code>.json`.
Language codes are validated before entering filenames. The source Markdown remains untouched;
prepared text is a derived reading artifact, never a store for review feedback.

The CLI requires both language codes and `.md` or `.markdown` on both the given path and its
canonical target:
`node bin/mastermind.js translate-blocks FILE --source-lang CODE --target-lang CODE` emits a fresh
plan; adding `--save` consumes the complete artifact JSON on stdin. The wrapper runs the TypeScript
CLI through tsx. Review opening is independent of artifact availability and always returns
without a completion wait.

The native host reads artifacts and watches them for changes, as documented in
[`desktop/src/translations.md`](../../desktop/src/translations.md). The UI validates every returned
artifact against the live buffer before offering or displaying it.
