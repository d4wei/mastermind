# Native blocking work

`worker.rs` owns two process-lifetime lanes for blocking work. The admission lane has one permit
and runs launcher and graphical admissions; they serialize on the document registry anyway. The
blocking-work gate runs every other native command: registry commands, document reads and writes,
Save As, translation reads, preferences, watcher registration, and initial setup. Its capacity is
an implementation constant. Callers await a permit before submitting a blocking worker; each
worker owns its permit until its closure finishes or unwinds, and a caller cancelled while still
waiting holds nothing.

Cancelling an awaiting command or expiring the launcher response deadline does not release
capacity held by a running operation. Tokio cannot abort a blocking operation after it starts. A
timed-out admission may still open documents; the launch protocol reports an unknown outcome. The
lanes bound submitted blocking operations, not filesystem duration, waiting async callers, or
retained documents.

Queued admissions wait for the admission permit, not for gate capacity, so a stalled admission
does not consume the capacity document commands need. Writes use a separate mutex to preserve host
write serialization without holding the document registry during disk I/O. Admission still holds
the registry while establishing its snapshots, so commands that resolve document IDs wait for a
stalled admission while holding gate capacity; the lanes do not claim isolation from a stalled
filesystem or hard filesystem cancellation.

Tests use controlled blocking closures to check capacity retention after caller cancellation and
timeout, cancellation while waiting, worker panic recovery, write serialization, registry
availability during a write, and a setup command completing behind a stalled admission.
