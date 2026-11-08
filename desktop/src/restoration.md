# Restoring open files

`restoration.rs` remembers which documents are open and which one is active, and readmits them when
the host next starts. Only that set persists. Document buffers, drafts, undo history, selections in
the text, and reading-language choices stay in the app session, and the file on disk remains the
only review channel.

## The inventory file

The inventory lives beside the preference file and takes its name, so `reviewer.json` gets
`reviewer.open-files.json`, and a disposable `MM_LAUNCH_CHECK_PREFERENCES` override (see
[setup](setup.md)) isolates it too. It is a small JSON object:

```json
{ "version": 1, "files": ["/abs/plan.md", "/abs/notes.md"], "active": "/abs/notes.md" }
```

`files` holds canonical paths in admission order; `active` is one of them or null. Writing keeps
the most recently admitted documents up to the per-request file bound, dropping `active` when it
falls outside them. Reading ignores a file that is oversized, malformed, carries unknown fields, or
names another `version`, and restores nothing; restoration's own write replaces it. A file that
exists but cannot be read, as with a sharing violation at launch, may still be valid: restoration
starts empty for this run and leaves the file until the open documents or the selection change.
Relative entries are dropped on read. A missing file is an empty inventory.

Writes use the preference module's atomic replacement (a synced temporary file renamed over the
path). On Unix the file is readable only by its owner, since it names the person's files.

## When it is written

The registry schedules a write after every change to the open set or the selection: admission
that activates a document, closing, Save As replacing a document's path, the renderer reporting a
selection through `select_document`, and restoration itself unless the inventory was unreadable.
Scheduling never waits on the filesystem. A dedicated writer thread waits a short settling delay,
then writes the latest inventory; changes arriving meanwhile replace one pending value, so a burst
of admissions writes once and a change during a write costs one more write. Once the writer is
idle, the file holds the last scheduled inventory unless that write failed. The writer compares each inventory it takes with what the file
holds and skips one that is equal. Application exit flushes without the settling delay and returns
once the last scheduled inventory is written, including one scheduled during a write in progress,
waiting a bounded time.

A failed write is reported on stderr and changes nothing else: the session continues, the person
sees no notice, and the next change writes again. Forced termination before the settling delay
ends can lose the last change.

## Restoring at launch

The host attaches the inventory to the registry during setup and queues restoration on the
admission lane described in [worker execution](worker.md). Restoration reads the inventory once
and readmits each path through the same `Documents` admission checks as any request: Markdown
extension, canonical identity and symlink rules, regular-file and size limits, and UTF-8 handling.
Restoring only reads the files. The startup task reads the remembered documents on a few threads
before taking the registry lock, then inserts them in saved order under it. Whichever runs first,
the startup task or a registry entry point, reads them; the other waits for those reads or finds
restoration done.

Restoration runs before anything else enters the registry once the inventory is attached. Admission,
inventory snapshots, and launcher close resolution each restore first when startup restoration has
not yet run, so a cold start triggered by the launcher or a file open event finds the remembered
documents admitted first. The triggering request's documents follow them, and its first successful
document becomes active as any request's does. A requested path that restoration already admitted
reports `already_open`. Launcher replies report only the requested paths, never restored ones.
Without a successful request, the remembered active document is selected, or the first restored
document when that one could not be reopened. Restoration only fills an empty selection, so a file
open event delivered before setup attached the inventory keeps its document active.

A remembered document that is missing, moved, or now refused is skipped. Its path joins
`restore_failures` in the inventory snapshot until the renderer reports it through a transient
notice and calls `dismiss_restore_failures`, and the rewritten inventory forgets it. Restored
documents are ordinary admitted documents: they stay open while setup is pending, and agents and
the person may close them.

Tests in `restoration.rs`, `admission.rs`, `opening.rs`, and `closing.rs` check the round trip,
atomic replacement, owner-only permissions, coalescing, a return to the saved inventory during a
write, flushing a change scheduled during a write, failed writes, corrupt, foreign, and unreadable
inventories, the bound, restore order and selection, reads prepared before the registry lock,
precedence of a triggering request, launcher close resolution before startup restoration, and
reporting of documents that could not be reopened.
