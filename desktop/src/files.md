# Native document I/O

`files.rs` owns bounded, versioned reads and guarded writes. `document_io.rs` accepts document IDs
from the admitted path registry; webview commands cannot name an arbitrary write destination.
Admission accepts `.md` and `.markdown`, case-insensitively, on both the selected path and canonical
target. The selected name is checked before any filesystem access, so a missing, oversized, or
special non-Markdown path also returns `not_markdown` without entering the registry. The picker
filters these extensions; CLI, document events, and drops use the same admission rule. Save As
rejects an unsupported extension before creating a file. These checks identify document types by
filename, not by guessing from content.

Admission canonicalizes paths, so an opened Markdown symlink and its target share one document. The
first webview read receives the admitted snapshot even if the path changed or disappeared after
opening was acknowledged. Subscribing after the document loads triggers a fresh read, retaining that
base and surfacing subsequent disk changes. Delivering the initial snapshot releases its host copy.

Reads open an existing regular file without following a final symlink or Windows reparse point. They
compare descriptor metadata before and after reading, then compare a second descriptor at the path.
Admitted paths are canonical, and every read and write first checks that the path still
canonicalizes to itself, so a parent directory swapped for a symlink is a conflict. On Unix the
open then walks the path one directory at a time without following links, so a swap after that
check cannot redirect it; Windows has only the check. Admission registers the file's identity, and
later reads and writes refuse, as conflicts, a file that does not continue it: a file on another
device or volume, or on Unix a replacement another user owns or that has a second hard link. A
replacement the same user renamed into place, as editors, `git`, and `sed -i` save, continues the
document.
Versions include filesystem identity, metadata, and SHA-256 of the raw bytes. The Windows identity
is the volume and file ID; Unix uses device and inode plus modification and change timestamps. A
changed or replaced path rejects the snapshot. Reads and changed writes share a size limit.
Unsupported types are checked before opening and again through descriptor metadata. Unix opens are
nonblocking only until the descriptor is confirmed to be a regular file.

A separate write mutex serializes this host's writes, including Save As. The document registry is
locked only to resolve the admitted path and, for Save As, to check and register the destination, so
writes do not hold that registry during disk I/O. Each write rechecks its supplied base version
through the opened descriptor. A base whose identity and digest match the current file is accepted
even when its metadata differs, so a metadata-only change, such as a mode, extended-attribute, or
sync-agent change to the Unix change time, does not reject the next save; changed bytes or a
replaced file still conflict. Missing paths are conflicts and are never recreated.

Snapshots reach the UI as `{ version, content, lossy }`. `content` is lossily decoded text; `lossy`
is true when the bytes are not valid UTF-8, so the UI can open such a file read-only. A UTF-8 byte
order mark is valid UTF-8. An unchanged string returns without writing, retaining original bytes
even when they contain invalid UTF-8. Changed content for a file that is not valid UTF-8 is refused
with `not_utf8`, because writing it would replace invalid sequences outside the edit; Save As can
write a UTF-8 copy instead. Changed content is written and truncated through the existing
descriptor, preserving inode, permissions, and admitted symlink aliases, then synced with
`sync_data`. A second snapshot checks the resulting content and path identity before reporting
success.

This is not a filesystem transaction. Unrelated writers do not share the mutex and can intervene
after validation. A partial write or process failure can leave partial content. In-place saves and
Save As both sync file data before reporting success; a new copy's directory entry is not synced,
and there is no unconditional overwrite fallback. A failed response leaves the UI's local text
available for recovery and retry.

Notify watches parent directories so replacing an individual file preserves the directory watch.
Prepared artifact directories share this lifecycle; see [translation discovery](translations.md).
Events invalidate the active document; a versioned read decides whether content changed. Access
events are ignored, including the close after a write, whose modification is reported separately.
Watch errors also invalidate. A removal event for a watched directory marks it removed; the next
watch request or close releases its registration and a watch request registers it again, so a
recreated directory is watched once. The event callback never waits on the watch set, and watch
calls are never made while holding it, because they can join the thread that runs the callback. The
UI revalidates on focus and at intervals even when watch registration succeeds; failed registration
uses a faster interval. When the platform watcher cannot be created, the host still starts and every
watch request fails with `watch_failed`. Inactive documents revalidate on return; their saves still
check versions. Network filesystem notifications and parent-directory replacement remain platform
validation work.

Native filesystem commands run on the blocking-work gate and admissions on a separate admission
lane, both described in [`worker.md`](worker.md). Filesystem work runs outside the event loop;
response deadlines do not cancel operations already running.

Native file and watch failures serialize `status`, `kind`, stable `error` code, and readable
`message`. `kind` is the UI's host failure: `conflict` for `file_changed`, `missing` for
`file_not_found`, `notUtf8` for `not_utf8`, and `failure` otherwise, including a document that is
no longer open; the UI reads only `kind` to choose recovery.
The opening inventory commands (`snapshot`, `close_document`, `dismiss_opening_errors`) can fail
only when their worker fails and report a plain string, like preference commands. Admission
returns the same code and message per failed path; graphical opening and the host adapter display
the message. Missing reads use `file_not_found`; denied access uses `permission_denied`; unsupported
file types use `not_supported_file`; oversized content uses `file_too_large`. Other I/O errors use
`file_io_error` with the OS diagnostic; watch registration failures use `watch_failed`. Registry
and translation validation retain their own codes.

Writes treat missing paths, paths replaced by unsupported types, and changed version/identity as
`file_changed` conflicts. Other read, metadata, and write errors preserve their classification,
including failures during post-write verification. A failed write can have modified disk bytes;
its error does not imply rollback. The document store retains local text for recovery.

Initial setup and per-field saved choices are described in [`setup.md`](setup.md).

## Saving a new copy

`save_document_copy` obtains its destination from the native save picker; the webview provides only
an admitted document ID and retained content. It cannot supply an arbitrary write path. Cancellation
returns without writing. Before creating anything, Save As checks the destination's extension and
requires a UTF-8 canonical path. `create_copy` uses exclusive creation, rejecting existing
destinations, including symlink and hard-link aliases. It checks the size, writes and syncs the
bytes, then reads back a versioned snapshot. Failure retains the renderer buffer; a partial new file
may remain and is never silently removed or overwritten on retry.

An ordinary Save As also refuses, before creation, a destination still registered to another
admitted document, such as one whose file was deleted, with `already_open`; the copy never merges
into that document. The originating document's own deleted path is allowed, since the copy replaces
its entry. On macOS and Windows the comparison ignores case, approximating their default volumes,
because a destination that does not exist yet keeps the case the person typed; on a case-sensitive
volume this only refuses a name that differs from an admitted document's by case. It does not
normalize Unicode, so on APFS a destination typed in another normalization form than an
admitted document's deleted path (a composed versus a decomposed `café.md`) is not recognized as
that path and the file can be registered twice. After creation the check is repeated, the new file
is admitted under a fresh ID with the snapshot creation verified, and the original document's
registry entry is removed. The original disk file is untouched. This does not advance activation:
the renderer switches only if the person still has the originating document selected. The registry
is unlocked during creation, so the originating document may close meanwhile; the copy then exists
on disk and was chosen by the person, so it is admitted as an ordinary new document and the active
document is unchanged. Unused watches are released. A failed creation or admission does not
release the original document.

When `forClose` is true, creation and readback use the same exclusive-copy path, but the new file
is not admitted and the original registry entry stays intact. The renderer can complete its close
only after the copy succeeds; cancelling the picker does not alter either document's state.
