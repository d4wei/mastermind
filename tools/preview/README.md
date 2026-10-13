# Browser development preview

Run `npm run dev -- /absolute/path/document.md`. The command starts a foreground localhost API and
Vite, then prints the `/d/preview` URL. `--port` selects the API port. Stop both with Ctrl-C.

The preview grants file access only to the existing document explicitly selected at startup. It
reads prepared translations beside that document and saves accepted changes with an opaque base
version. Browser settings exist in memory for the lifetime of the process. No daemon, personal
configuration file, workspace browsing, draft creation, rename, or agent installation is provided.

Host and Origin guards restrict HTTP requests to localhost. Theme assets pass lexical and canonical
containment checks, including symlink checks, before reading. The preview is development machinery
and is not the desktop runtime.
