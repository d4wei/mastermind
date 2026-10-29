# Native launcher protocol

The repository launcher forwards `open [--language CODE] -- FILE...`, `close -- FILE...`, and
`setup --suggest JSON_OBJECT` to the native app. Opening resolves relative paths against the
invoking process's directory, starts or reuses one local host, and reports admission without
waiting for onboarding or review completion. The Windows console companion preserves command
output without attaching a console to the GUI. A launcher started with
`MM_LAUNCH_CHECK_ATTACH_ONLY` set, as the repository launcher does for a debug build, never starts
a host: without one it replies `host_not_running`.

`protocol.rs` owns the version, request and reply frame bounds, request bounds, strict request
envelopes, and reply fields. Open, close, and setup are distinct operations; unknown or mixed fields
reject the request. The transport checks versions before admission. `endpoint/` scopes local
sockets or named pipes to the OS user; endpoint existence does not authorize reading arbitrary
files. On Unix the socket lives under the user's runtime directory, so a shell that overrides
`TMPDIR` still reaches the desktop-launched host; `endpoint/unix.rs` owns the per-platform order of
candidate directories. Both ends of a Unix connection also refuse a peer running as another user
with `unexpected_endpoint_owner`; on Windows the pipe's access list admits only the user and the
launcher checks the server's owner.

For a valid opening request, results retain input order and distinguish `opened`, `already_open`,
and `error`. Admission checks existing regular files, obtains an initial versioned snapshot, and
registers canonical identity before success. Selected paths and their canonical targets must have
a Markdown extension; [file access](files.md) owns the supported extensions. Markdown aliases reuse
the document. Reopening retains the document's buffer, undo, and recovery state. One file's
failure does not prevent other valid files from opening. See [opening](opening.md) and
[file access](files.md) for activation, graphical requests, and filesystem limits.

The optional initial reading-language hint follows [translation discovery](translations.md).

## Closing

`close -- FILE...` takes at most 64 paths, resolved like opening's, and matches each by canonical
path against admitted documents; a deleted file matches through its canonical parent. Closing does
not require a Markdown extension. Results retain input order and report `closed`, `not_open`,
`blocked` with a `reason`, or `error` with a code. `not_open` is success, so closing is idempotent,
and with no host running every path is `not_open` without starting one. No option discards work.

The host never removes a document itself. It asks the subscribed renderer with a
`close-files-requested` event carrying a request ID and the document IDs, then waits a bounded
time, shorter than the response deadline, for `complete_close_request` with that ID. The renderer
saves each document without prompting, then reports `pending_draft` for an unfinished comment,
reply, or suggested change, `unsaved_edits` for edits not saved, and `recovery` for a document
awaiting a recovery choice; otherwise it closes the document as the file pill does and reports
`closed`. Without a subscribed renderer, an answer in time, or while the window is closing, the
document is `blocked` with `renderer_unavailable` and stays open. Concurrent requests carry
distinct IDs; an answer after the deadline is discarded, and a retry reports what then holds.
Closing never raises the window. The [renderer's close path](../../ui/desktop/README.md) owns the
checks.

Stdout contains one JSON reply; diagnostics go to stderr. Replies carry file admission metadata,
not document contents or feedback. Exit status is zero for a fully successful operation, one for
per-file failures or blocked closes, two for invalid invocation, request errors, or
`host_not_running`, and three for an unknown outcome.
A host with every connection slot taken replies `busy` without reading the request; a failed host
worker replies `host_failure`. A setup suggestion whose saved preferences cannot be read or
validated replies `preferences_unreadable`. Each of these exits two.
A lost acknowledgment or timeout may follow successful admission. Retrying is safe; the launcher
never kills the app or rolls back files solely because its connection failed. On Unix the launcher
starts the app in its own process group, so interrupting or signalling the launcher's group does
not stop an app holding unsaved edits. If the app it started exits unsuccessfully before
accepting a connection, the launcher reports an unknown outcome without waiting for the deadline.
The app keeps accepting launcher connections after accept failures, backing off while they repeat.

`onboarding_needed` reports the host's setup state, or null when that state cannot be established.
A successful setup suggestion returns per-field `accepted` or `ignored`; it does not persist choices
or mean a person has confirmed them. The [setup contract](setup.md) owns those rules.

There is no completion signal, waiting review command, or second feedback channel. Agents reread
the Markdown file when the person asks them to continue. The local opening transport is separate
from the React-to-Rust command bridge used for reading, saving, and watching admitted documents.
