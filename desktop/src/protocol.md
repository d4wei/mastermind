# Native launcher protocol

The repository launcher forwards `open -- FILE...` and `setup --suggest JSON_OBJECT` to the native
app. Opening resolves relative paths against the invoking process's working directory, starts or
reuses one local host, and reports admission without waiting for onboarding or review completion.
The Windows console companion preserves command output without attaching a console to the GUI.

`protocol.rs` owns the version, frame and request bounds, strict request envelopes, and reply
fields. Open and setup are distinct operations; unknown or mixed fields reject the request. The
transport checks versions before admission. `endpoint/` scopes local sockets or named pipes to the
OS user; endpoint existence does not authorize reading arbitrary files.

For a valid opening request, results retain input order and distinguish `opened`, `already_open`,
and `error`. Admission checks existing regular files, obtains an initial versioned snapshot, and
registers canonical identity before success. It does not require a Markdown extension. Aliases
reuse the document. Reopening retains the document's buffer, undo, and recovery state. One file's
failure does not prevent other valid files from opening. See [opening](opening.md) and
[file access](files.md) for activation, graphical requests, and filesystem limits.

Stdout contains one JSON reply; diagnostics go to stderr. Replies carry file admission metadata,
not document contents or feedback. Exit status is zero for a fully successful operation, one for
per-file failures, two for invalid invocation or request errors, and three for an unknown outcome.
A lost acknowledgment or timeout may follow successful admission. Retrying is safe; the launcher
never kills the app or rolls back files solely because its connection failed.

`onboarding_needed` reports the host's setup state, or null when that state cannot be established.
A successful setup suggestion returns per-field `accepted` or `ignored`; it does not persist choices
or mean a person has confirmed them. The [setup contract](setup.md) owns those rules.

There is no completion signal, waiting review command, or second feedback channel. Agents reread
the Markdown file when the person asks them to continue. The local opening transport is separate
from the React-to-Rust command bridge used for reading, saving, and watching admitted documents.
