# Document state and save ownership

`createDocStore` retains an in-memory record for each visited document: normalized source, saved
base, exact disk text, line endings, opaque disk version, review undo, write status, autosave timer,
read generation, and pending invalidation. Editor callbacks belong to one document and
external-buffer revision.

The source editor writes every change through to the store synchronously, so navigation and saves
never flush it. Loading an unvisited document releases the departing record from the published
state at once; until the load succeeds no document is active, and commands reach no record, including
after a failed load. Retained documents revalidate on return. Read generations reject stale
completions. Saves update their originating record even after navigation and schedule another write
if its buffer changed during the request. Clean external changes reload automatically and clear review
undo, whose snapshots predate the external text. Unedited files are not written; ordinary writes
restore the original line endings.

## Files that are not valid UTF-8

A host snapshot's `lossy` flag marks bytes that are not valid UTF-8; an absent flag reads as false.
Such a document is read-only in place: editing entry points are no-ops, autosave never schedules,
and the UI disables review actions and Markdown-mode typing through `editingLocked`, as during
recovery. Every read refreshes the flag, so a file rewritten as UTF-8 becomes editable again; a
read of the version already held keeps a flag the host proved by refusing a write. That refusal
(`notUtf8`) marks the record lossy instead of entering recovery, since the file is unchanged and
Retry cannot succeed; any edits already in the buffer stay pending so closing offers Save As.
`ConflictPanel` shows a persistent notice whose only action is Save As, which writes a UTF-8 copy.

## Recovery

`recovery` pauses mutations for a file that cannot be safely written and names one reason:
`changed` for a verified external change, `missing` for a missing path, and `readFailed` or
`saveFailed` for other read and write failures. `missing` requires evidence: a deletion event or a
host `missing` read result. Other read failures cannot distinguish a missing path from an
unreadable one, so a missing diagnosis persists through them until a read succeeds. Reading back
the held version resolves `readFailed` and `missing` and leaves `changed` and `saveFailed` for Retry
or Use incoming. A deletion event or a failed read replaces any diagnosis with `missing` or
`readFailed`, which a later read of the held version then clears. A failed copy has its own `copyError` and does not change that diagnosis. Leaving
recovery clears its dismissal and copy failure; a successful write also clears copy failure.
Reading, copying, navigation, other documents, and closing remain available.

`ConflictPanel` provides two direct choices. A `changed` file offers Save As and Use incoming;
every other recovery offers Retry and Save As. Use incoming replaces the notice with
confirmation before reading again and adopting the current disk version. No second box opens.
A newer invalidation rejects adoption; its read then presents the newer version for the same choice.
Review undo can recover the discarded local buffer until the next external change replaces the
buffer.
There is no merge operation or comparison editor.

Retry reads before attempting a write. Reading the acknowledged version clears a read failure and
allows pending edits to save. Changed disk contents with local edits remain blocked. A fresh read
matching the current buffer reconciles the file as saved. A fresh read matching the exact disk text
last read or written, including mixed line endings, refreshes the version token and resumes saving
pending edits without changing local text or undo history. Every write still checks that fresh
token, so intervening disk changes reject the save. A failed write may have partially changed the
file, so it queues verification and retains the buffer rather than claiming rollback.

Save As obtains its destination from the native host. Cancellation and failure keep the original
buffer. Success admits the new file and releases the original record, selecting the copy only if
navigation has not moved elsewhere. Composer drafts transfer separately in memory; they are not
part of the saved copy.

Ordinary writes and recovery operations are tracked separately. Closing awaits both. Invalidations
during recovery reads reject the operation; invalidations during writes are rechecked afterward, and
a deletion recorded during a write survives that write's failure.
Recovery completion always updates its owning file. Filesystem concurrency limits live in
[file I/O](../../desktop/src/files.md).

Dismissal retains the condition and replaces the notification with a warning icon. Repeated events
do not reopen it. File tabs retain an attention action. Recovery hides while the native picker or
close decision owns interaction. Notices share the bottom-left notification host.

## Closing and lifecycle

`prepareToClose` starts idle saves, awaits writes and recovery, then saves remaining buffers in its
requested scope. A clean file may close even when a stale warning or missing original remains.
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

Process termination and crashes can lose in-memory work. Composer lifetime is documented in [drafts](../review/drafts.md);
persisted buffers remain deferred in DIRECTION.md.
