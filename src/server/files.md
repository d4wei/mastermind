# Document file I/O

`readSessionFile` reads bytes and metadata through one descriptor and checks that the descriptor and
path still refer to the same unchanged file. A changed, replaced, or missing file rejects the read.
Its opaque version combines content and filesystem identity; callers must send the version they
based an edit on. HTTP writes reject a missing version rather than permitting an unconditional save.

`writeSessionFile` queues this process's writes by canonical path. Each write validates its base
after preceding writes finish, so competing changes from one base cannot both apply. Deleted paths
are conflicts and are not recreated. Unedited saves leave the
original bytes intact, including bytes that cannot round-trip through UTF-8 decoding.

Changed content is written through the existing inode to preserve symlinks and permissions. This
can expose partial content during writing and can leave a partial write after an I/O failure; it is
not an atomic replacement or a crash-durable transaction. An unrelated process can write or replace
the path after validation. The post-write check catches some interference, but no cooperative lock
or atomic compare-and-swap exists between this app and unrelated writers. A successful response is
the observed written version, not a guarantee against a subsequent external edit.
