# Browser development preview

Run `npm run dev -- path/to/document.md`. A relative path resolves against the directory `npm run`
was invoked from; a direct `tsx tools/preview/index.ts` run resolves it against its own working
directory. The command starts a foreground localhost API and Vite, then prints the
`/d/preview` URL. `--port` selects the API port. Stop both with Ctrl-C.

The preview grants file access only to the existing document explicitly selected at startup. It
requires `.md` or `.markdown` on both the selected path and canonical target, case-insensitively. It
reads prepared translations beside that document and saves accepted changes with an opaque base
version. Like the native host, its file snapshot carries `lossy: true` when the bytes are not valid
UTF-8, and it refuses changed content for such a file with a 422 `not_utf8` error. Browser
settings exist in memory for the lifetime of the process; an update accepts only known keys whose
values have the default's type, and an author tag only when it is a usable author name. No daemon,
personal configuration file, workspace browsing, draft creation, rename, or agent installation is
provided.

The event stream reports a missing file once per disappearance, counting a path that no longer
stats as a regular file, and the first successful read afterwards as changed, including when the
stream opened while the file was missing. A read that fails after a successful stat is retried on
the next poll rather than reported. A failed document read answers with kind `missing` whatever its
cause, so the reviewer diagnoses every preview read failure as a missing path; the native host
reports read failures other than a missing path as `failure`.

A Host guard restricts HTTP requests to localhost, and a request carrying an Origin must come from
the address it was sent to, so pages served on other local ports are refused. Vite's CORS handling
is off, so preflights reach that check. Theme assets are the set the desktop build ships and pass
lexical and canonical containment checks, including symlink checks, before reading. The preview is
development machinery and is not the desktop runtime.
