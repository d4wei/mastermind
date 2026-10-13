# Native document I/O

`files.rs` owns bounded, versioned reads and guarded writes. `reviewer.rs` accepts document IDs
from the admitted path registry; webview commands cannot name an arbitrary write destination.
Admission canonicalizes paths, so an opened symlink and its target share one document. The first
webview read receives the admitted snapshot even if the path changed or disappeared after opening
was acknowledged. Subscribing after the document loads triggers a fresh read, retaining that base
and surfacing subsequent disk changes. Delivering the initial snapshot releases its host copy.

Reads open an existing regular file without following a final symlink or Windows reparse point.
They compare descriptor metadata before and after reading, then compare a second descriptor at
the path. Versions include filesystem identity, metadata, and SHA-256 of the raw bytes. The
Windows identity is the volume and file ID; Unix uses device and inode plus metadata timestamps.
A changed or replaced path rejects the snapshot. Reads and changed writes have a size limit.

A separate write mutex serializes this host's writes. The document registry is locked only to
resolve the admitted path, so writes do not hold that registry during disk I/O.
Each write rechecks its supplied base version through the opened descriptor. Missing paths are
conflicts and are never recreated. An unchanged decoded string returns without writing, retaining
original bytes even when they contain invalid UTF-8. Changed content is written and truncated
through the existing descriptor, preserving inode, permissions, and admitted symlink aliases.
A second snapshot checks the resulting content and path identity before reporting success.

This is not a filesystem transaction. Unrelated writers do not share the mutex and can intervene
after validation. A partial write or process failure can leave partial content. No crash-durability
claim or unconditional overwrite fallback is made. A failed response leaves the UI's local text
available for comparison and retry.

Notify watches admitted files' parent directories, so replacement does not detach the file watch.
Events invalidate the active document; a versioned read decides whether content changed. Read-only
access events are ignored. Watch errors also invalidate. The UI revalidates on focus and periodically
even when watch registration succeeds; failed registration uses a faster interval. Inactive retained
documents revalidate on return;
their saves still check versions. Network filesystem notification behavior and parent-directory
replacement need further validation before adopting this as the production host.

Native filesystem commands and admission share the blocking-work gate described in
[`worker.md`](worker.md). Filesystem work runs outside the event loop; response deadlines do not
cancel operations already running.
