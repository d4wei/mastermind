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
writes pause. Events arriving during writes are reconciled afterward. The comparison interaction
remains a separate design. `saveForce` reads the current disk version and submits the captured
local text against that version; it does not bypass the server's conflict guard.

`documentLifecycle.ts` registers at the app level so retained documents remain protected outside
a document route. Blur and visibility changes start saves for all retained records. Browser
unload cannot await those writes: while any record is dirty or saving, the handler requests the
browser's leave-page prompt. Accepting that prompt, process termination, and app crashes can
still lose unsaved in-memory buffers. Native close waiting belongs to the future desktop host.
