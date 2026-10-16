# Native document opening

The launcher, native dialog, macOS document events, and window file drops share `Documents::admit`.
Admission reads and retains a snapshot before reporting success. Canonical paths reuse an existing
document; reopening never replaces its snapshot or the renderer's working buffer.

Each admitted document receives a monotonically allocated ID; closing never shifts or reuses IDs.
Each successful request retains the first successful document's ID and advances an activation
revision. The renderer applies a newer revision once, so periodic inventory reads do not undo a
person's selection. Failed requests retain the prior selection. The native host asks the OS to
show, unminimize, and focus the window after admission; OS focus policy may decline that request.
Before window creation, selection remains in the registry for the first renderer snapshot.

`opening.rs` converts graphical inputs into the same bounded request. Conversion and per-file
failures remain in the inventory snapshot until dismissed or replaced by another graphical request.
Cancellation of a native dialog does nothing. Launcher errors remain in its JSON response.
File reads run outside the event loop. The registry mutex serializes admissions and guarded saves.

The pinned [Tauri dialog plugin](https://v2.tauri.app/plugin/dialog/) supplies the native multi-file
picker; Rust opens the selected files through the application's admission checks. The frontend has
no generic filesystem plugin permission. The macOS bundle declares Markdown support with alternate
handler rank; it does not request ownership of the system's default Markdown handler. The Windows
installer packages a GUI app and a short-lived console launcher. The launcher forwards requests to
the GUI executable's command mode; both use the same admission protocol. Windows file associations
remain unconfigured, while dialogs and window drops use native events on both platforms.

`close_document` removes the admitted path and snapshot without touching disk contents. The renderer
first saves and checks that document while editing is locked. The command accepts the renderer's
current selection and observed activation revision. A concurrent opening request takes precedence;
otherwise closing the active file selects its next neighbor, then its previous neighbor. Closing
another file preserves selection, and closing the last file leaves no active document. A completed
close advances the revision so older inventory responses cannot restore a removed pill.
Directory watches are released when no admitted file uses the directory; failed removals remain
eligible for retry on the next close. Watch registration and removal share the registry lock.

The host retains admitted documents without a total session limit. Inventory polling and raw OS
error details remain bounded hardening work. See the [observations](../../tools/desktop/results.md)
for packaged behavior actually exercised.
