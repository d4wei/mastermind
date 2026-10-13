# Native document opening

The launcher, native dialog, macOS document events, and window file drops share `Documents::admit`.
Admission reads and retains a snapshot before reporting success. Canonical paths reuse an existing
document; reopening never replaces its snapshot or the renderer's working buffer.

Each successful request retains the first successful document's index and advances an activation
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

This is the validation host. Inventory polling, raw OS error details, and the absence of a total
retained-document limit are not a finished production opening service. See the
[observations](../results.md) for packaged behavior actually exercised.
