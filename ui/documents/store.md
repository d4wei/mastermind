# Document state and save ownership

`createDocStore` retains an in-memory record for each visited document: normalized source, saved
base, line endings, opaque disk version, review undo, write status, autosave timer, read generation,
and pending invalidation. Editor callbacks belong to one document and external-buffer revision.

Navigation flushes the departing editor. Retained documents revalidate on return. Read generations
reject stale completions. Saves update their originating record even after navigation and schedule
another write if its buffer changed during the request. Clean external changes reload automatically.
Unedited files are not written; ordinary writes restore the original line endings.

## Recovery

`conflict` pauses mutations for a file that cannot be safely written. `recoveryError` distinguishes
read and write failures from a verified external change; `diskChange.deleted` requires evidence
that the path is missing. A failed copy has its own `copyError` and does not change that diagnosis.
Reading, copying, navigation, other documents, and closing remain available.

`ConflictPanel` provides two direct choices. A conflicting version offers Save As and Use incoming;
a failed read/write or missing file offers Retry and Save As. Use incoming replaces the notice with
confirmation before reading again and adopting the current disk version. No second box opens.
A newer invalidation rejects adoption. Review undo retains the prior local buffer for this session.
There is no merge operation or comparison editor.

Retry reads before attempting a write. Reading the acknowledged version clears a read failure and
allows pending edits to save. Changed disk contents with local edits remain blocked. A fresh read
matching the current buffer reconciles the file as saved. A fresh read matching the saved baseline,
including its line endings, refreshes the version token and resumes saving pending edits without
changing local text or undo history. Every write still checks that fresh token, so intervening disk
changes reject the save. A failed write may have partially changed the file, so it queues verification
and retains the buffer rather than claiming rollback.

Save As obtains its destination from the native host. Cancellation and failure keep the original
buffer. Success admits the new file and releases the original record, selecting the copy only if
navigation has not moved elsewhere. Composer drafts transfer separately in memory; they are not
part of the saved copy. The browser development host has no save picker capability.

Ordinary writes and recovery operations are tracked separately. Closing awaits both. Invalidations
during recovery reads reject the operation; invalidations during writes are rechecked afterward.
Recovery completion always updates its owning file. Filesystem concurrency limits live in
[file I/O](../../desktop/src/files.md).

Dismissal retains the condition and replaces the notification with a warning icon. Repeated events
do not reopen it. File tabs retain an attention action. Recovery hides while the native picker or
close decision owns interaction. Notices share the bottom-left notification host.

## Closing and lifecycle

`prepareToClose` flushes editor input, awaits writes and recovery, then saves remaining buffers in
its requested scope. A clean file may close even when a stale warning or missing original remains.
`pendingDocuments` enumerates actual unsaved or busy records; warning visibility cannot trap exit.

The native [close coordinator](../desktop/confirm-close.ts) handles meaningful drafts first, then
flushes autosave. Success closes silently. A slow save exposes Cancel; it cancels closing, not an
already dispatched write. Failed or blocked saving offers Save As, Don't Save, and Cancel. The
sheet names only remaining unsaved files. Successful copies are removed from that decision; a
cancelled picker returns without an error and a failed copy updates the same sheet.

Discard and successful-copy approvals name document revisions. Later edits cannot inherit them.
`closeDocument` awaits native removal before releasing a record, its editor history, and drafts.
A failed removal retains the record. Pending loads/reads cannot resurrect a closed file.
Save As during closing writes a new file without admitting it or replacing the original tab.
The adapter locks editing and pauses admission activation during close decisions.

`documentLifecycle.ts` starts saves on browser blur and visibility changes. Browser unload cannot
await writes and asks before leaving pending work. Process termination and crashes can lose
in-memory work. Composer lifetime is documented in [drafts](../review/drafts.md); persisted buffers
remain deferred in DIRECTION.md.
