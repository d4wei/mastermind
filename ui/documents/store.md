# Document state and save ownership

`createDocStore` retains an in-memory record for each visited document: normalized source, saved
base, line endings, opaque disk version, review undo, write status, autosave timer, read generation,
and pending invalidation. The active Zustand projection and retained registry have separate owners.
Editor callbacks belong to one document and external-buffer revision.

Navigation flushes the departing editor. Retained documents revalidate on return; failed navigation
leaves the previous record available. Read generations reject stale completions. Ordinary save
responses update their originating record even after navigation and schedule another write if its
buffer changed during the request. Clean external changes reload automatically.

## Conflict recovery

A dirty external change retains the base and local text and pauses both editing and autosave for
that document. Store mutation entry points reject changes, including review undo. The mounted
source editor becomes read-only without replacing its state; comment composers retain their text
and disable submission. Reading, copying, navigation, and other documents remain available.

`ConflictPanel.tsx` offers these explicit operations:

- **Use incoming** asks for confirmation before discarding local edits. It reads again and adopts
  the incoming text only if no newer invalidation or local revision supersedes the read. The prior
  local buffer remains in review undo for this app session.
- **Try merge** reads again, merges base/local/incoming with [`mergeText`](../../document/merge.ts),
  and saves a clean result immediately against that incoming version. Overlap or a merge limit
  writes nothing. It never inserts conflict markers or reserializes Markdown. The previous local
  buffer remains in review undo. Host version checks still reject a changed or missing original.
- **Save my version as…** uses the native save-copy operation. Cancellation or failure retains
  the original buffer. Success admits the new file and releases the original record; the
  app selects the copy only if the person has not navigated elsewhere. The original disk file is
  untouched. The browser development host has no save picker capability.
- **Copy my version** provides a clipboard escape when a destination is unavailable. The Markdown
  view also supports selecting and copying the retained text.

Recovery reads and writes mark the document busy, preventing simultaneous recovery and close.
Invalidations during reads reject the operation; invalidations during writes trigger revalidation
when the write settles. Failed writes retain local text and reread because a failure can follow a
partial filesystem write. Reads cannot always distinguish missing from unreadable files; only a
known deletion selects the missing-file message. The native filesystem's concurrency limits are
specified in [file I/O](../../desktop/src/files.md).

`conflictDismissed` hides the expanded notice without resolving the conflict. File tabs and a
compact notification keep recovery reachable. Repeated invalidations do not reopen a dismissed
notice. Recovery completion updates its owning record even if another file is active.

Ordinary writes restore the original line endings; merges restore the incoming version's line
endings. Unedited files are not written. There is no editable comparison-result buffer.

## Closing and lifecycle

`documentLifecycle.ts` starts saves on blur and visibility changes. Browser unload cannot await
writes; any dirty, saving, or conflicted record requests the browser's leave-page prompt. Accepting
that prompt, process termination, or a crash can still lose unsaved in-memory buffers.

`prepareToClose` flushes the editor, awaits ordinary writes, saves remaining buffers, then checks
all records. An active recovery operation or unresolved conflict keeps the window open. Native close
locks editing while this check runs; [native validation](../../tools/desktop/results.md) records
platform coverage.

`closeDocument` checks one file, awaits host removal, then drops its record. Failure retains it.
Closing invalidates pending reads and loads for that file without cancelling another file's load.
The native adapter locks editing during close. Source-editor history is released with the record,
including cleanup after the active editor unmounts.
