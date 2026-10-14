# Native blocking work

`worker.rs` shares one process-lifetime concurrency gate across launcher admission, graphical
admission, registry commands, document reads and writes, translation reads, preferences,
watcher registration, and initial setup. The capacity is an implementation constant. Callers await
capacity before submitting a blocking worker; each worker owns its permit until its closure
finishes or unwinds.

Cancelling an awaiting command or expiring the launcher response deadline does not release
capacity held by a running operation. Tokio cannot abort a blocking operation after it starts. A
timed-out admission may still open documents; the launch protocol reports an unknown outcome. This
gate bounds submitted blocking operations, not filesystem duration, waiting async callers, or
retained documents.

Writes use a separate mutex to preserve host write serialization without holding the document
registry during disk I/O. Admission still holds the registry while establishing its snapshots. A
stalled admission can therefore delay workers that resolve document IDs; the gate does not claim
isolation from a stalled filesystem or hard filesystem cancellation.

Tests use controlled blocking closures to check capacity retention after caller cancellation and
timeout, worker panic recovery, write serialization, and registry availability during a write.
Preferences writes also serialize natively, so concurrent commands cannot share their temporary
file.
