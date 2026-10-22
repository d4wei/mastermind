# Native preference persistence

`preferences.rs` owns the native preference path, bounded JSON reads, serialized replacement writes,
while `setup.rs` owns settings commands, validation, and the read-modify-write mutex shared
by initial confirmation and ordinary settings patches. Concurrent patches retain each other through
that mutex. Neither reader persists computed defaults.

Preference reads use the same byte limit as preference writes, checking one additional byte before
JSON parsing. Oversized preferences are rejected without rewriting the file. Preference command
failures keep their string response shape; document and admission errors use the structured shape.

Writes sync a temporary file in the same directory, then rename it over the preference path, so
readers see either the previous or the new complete object. The rename itself is not synced, and it
replaces a symlinked preference path with a regular file. The writer mutex
protects that temporary path from competing writes within this host. This is separate from the
setup mutex, which protects the complete read-modify-write operation.

The trusted absolute test-harness path override and saved-choice semantics are described in
[`setup.md`](setup.md). Tests check the preference byte boundary, concurrent complete writes,
patch preservation, malformed-file protection, and confirmation retry.
