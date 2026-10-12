# Document state and save ownership

`createDocStore` retains an in-memory record for every visited session. Each record owns its
normalized source, saved base, original line endings, opaque disk version, review undo history,
write state, and autosave timer. The Zustand state exposes the active record; editor callbacks
are valid only for the document and external-buffer revision where they registered.

Navigation flushes the departing editor before loading another session. Retained documents are
revalidated on return. Failed navigation leaves the departing record available. Load requests
and disk reads carry generations; write boundaries invalidate older disk reads. Save responses
update their originating record even after navigation, and a successful save schedules another
write if the buffer changed during the request.

A clean external change replaces the displayed source and base. A dirty change keeps the base
and local buffer and captures the disk content and version in `diskChange`; further automatic
writes pause. Events arriving during writes are reconciled afterward. Comparison is explicit,
and does not depend on Markdown mode. A disk conflict or unavailable file clears the previous
transient notice; the persistent conflict notice presents the current recovery action.

## Conflict comparison

Each document retains its comparison draft through panel close and navigation. The draft holds
Base, captured Local and its monotonically increasing source revision, the reviewed Disk token
and bytes, and an editable Result initialized to Local. Editing Result changes no document or
disk bytes. Later local or disk changes mark the draft stale; they never replace Result.
An explicit refresh updates the comparison snapshots while preserving Result. Edits arriving
during that refresh still invalidate its captured Local revision.

Save result requires both the captured Local revision and the displayed Disk token to remain
current. The write sends that exact token to the server. A conflict response refreshes the latest
Disk for comparison while preserving the stale draft; the user must explicitly refresh before
retrying against a different version. Successful completion changes only its originating document.
If local edits arrived during the write, they remain in the buffer and saving stays paused rather
than silently replacing them with Result. Save failure retains the result for retry.

Use disk validates the displayed token with a disk read and rechecks its Local revision and read
generation before adopting it. The discarded Local buffer remains in review undo. Missing paths
block both apply actions; refresh retries reading without recreating the file. Any failed read
invalidates the comparison's apply token while retaining its text. An unavailable response can mean
missing or unreadable; only a deletion event establishes the missing-file notice. Repeated reads
and refreshes share generation guards, and write boundaries invalidate older reads.

`ConflictPanel.tsx` presents the persistent viewport notice and the shared SlideOver comparison
shell. Result is a manual text merge; no automatic merge or normalized Markdown serialization is
involved. Ordinary writes and accepted Result restore the appropriate original line endings.

`documentLifecycle.ts` registers at the app level so retained documents remain protected outside
a document route. Blur and visibility changes start saves for all retained records. Browser
unload cannot await those writes: while any record is dirty, saving, or holds a distinct edited
Result, the handler requests the browser's leave-page prompt. Accepting that prompt, process
termination, and app crashes can still lose unsaved in-memory buffers.

`prepareToClose` flushes the editor, awaits existing ordinary writes, and saves any remaining
buffer changes before checking all retained documents. It returns false for unresolved work,
including a distinct comparison result or an active comparison save. The native adapter locks
editing while awaiting this check and keeps the window open on failure. Native operating-system
quit coverage is tracked in the [host observations](../../../tools/native-launch/results.md).
