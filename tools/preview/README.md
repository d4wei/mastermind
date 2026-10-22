# Browser development preview

Run `npm run dev -- path/to/document.md`. A relative path resolves against the directory `npm run`
was invoked from. The command starts a foreground localhost API and Vite, then prints the
`/d/preview` URL. `--port` selects the API port. Stop both with Ctrl-C.

The preview grants file access only to the existing document explicitly selected at startup. It
requires `.md` or `.markdown` on both the selected path and canonical target, case-insensitively. It
reads prepared translations beside that document and saves accepted changes with an opaque base
version. Browser settings exist in memory for the lifetime of the process; an update accepts only
known keys whose values have the default's type. No daemon, personal configuration file, workspace
browsing, draft creation, rename, or agent installation is provided.

The event stream reports a deleted file once per disappearance and a recreated file as changed. A
read that races a save is retried on the next poll rather than reported.

A Host guard restricts HTTP requests to localhost, and a request carrying an Origin must come from
the address it was sent to, so pages served on other local ports are refused. Vite's CORS handling
is off, so preflights reach that check. Theme assets are the set the desktop build ships and pass
lexical and canonical containment checks, including symlink checks, before reading. The preview is
development machinery and is not the desktop runtime.
