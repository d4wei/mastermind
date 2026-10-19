# Reading translation discovery

`list_translations` accepts an admitted document ID, resolves its source path through the registry,
and reads `.mastermind/translations/<basename>.<language>.json` beside that document. It returns
candidate artifacts, not a claim of freshness. The shared document matcher validates candidates
against the current UI buffer. A malformed target does not hide other targets.

`translations.rs` checks language syntax, canonical containment, regular files, filename/target
identity, per-file bounds, and bounded aggregate output. Redirected directories and artifact
symlinks are rejected. Language and discovery limits live in the implementation; the source format
remains in `document/translation.ts`. `read_translation` supplies one fresh artifact for validating
an exact captured quote before a comment is submitted.

The existing nonrecursive watcher covers the source parent and available `.mastermind` and
`translations` directories. Invalidation rechecks these paths, so a previously absent directory
can be added to the watch set. Events are hints; periodic revalidation covers missed events and
replacement. Closing documents releases watch paths no longer used by an admitted document.
The UI coalesces discovery hints and rejects responses from an earlier document or choice.

`open --language CODE -- FILE...` includes an optional `language` in the opening protocol request.
The registry retains the first hint for each admitted document and exposes it in opening snapshots.
The UI applies it only to an available valid translation before the reader chooses a version.
Unavailable hints leave Original; they do not trigger generation or change preferences. Closing
releases the hint, and reopening receives a new document identity.
