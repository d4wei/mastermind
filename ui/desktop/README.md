# Native reviewer adapter

`main.tsx` installs the native host before mounting the existing React reviewer. `host.ts` adapts
Tauri commands to `app/host.ts`; failures become host-level conflict, missing, or failure results.
The document store does not interpret native command envelopes or HTTP statuses. Prepared translations still pass through the shared TypeScript freshness
and source-mapping checks. Theme assets are bundled, and preferences use the native application
config directory.

The optional host appearance operation connects loaded theme colors to the native background
surface and light/dark appearance. Its [theme adapter](../theme/appearance.md) owns conversion and
load timing.

The active document receives immediate native watcher invalidations and periodic revalidation to
cover silent event loss or a watch left on a replaced parent directory. Healthy watcher registration
uses a five-second interval; registration failure uses a one-second interval. Closing the document
subscription releases its listener and timer, including registrations that finish after navigation.
Periodic invalidation skips an interval while that document has native reads in flight, so a slow
read can settle without being superseded by the timer. Reads of other documents do not pause it.
Native watcher events still invalidate immediately. Each revalidation reads and hashes the active
file through the versioned native read path even when contents have not changed. This adds periodic
filesystem and renderer work; it does not repair
the underlying OS watch. The [notify watcher caveat][notify-watch] describes path replacement
behavior.

[notify-watch]: https://docs.rs/notify/8.2.0/notify/trait.Watcher.html#tymethod.watch

`NativeReviewer.tsx` provides the square Open Markdown files action and horizontally scrolling
file pills. The native Edit → Find entry forwards to the shared
[Find controller](../find/README.md) and is disabled without a ready document.
`file-labels.ts` adds parent directories only to distinguish duplicate filenames. The active file's
full path remains in the native window title and the pill tooltip. On macOS, Tauri's overlay title
bar hides the separate title strip, retains the traffic lights, and extends the theme behind the
toolbar. Empty toolbar and pill-row space uses Tauri drag regions; buttons remain interactive.
Other platforms retain their native title bars and window controls. The native title command sets
macOS metadata and requests a redraw of Wry's parent view together, restoring the configured
traffic-light inset after AppKit resets it on a title update
([Tauri issue](https://github.com/tauri-apps/tauri/issues/13044)).

Each pill has a separate, keyboard-accessible close button and an attention action for conflicts.
Closing and quitting use the
[document recovery contract](../documents/store.md#closing-and-lifecycle).
Editing and inventory activation pause during the close. The native result selects the next file,
then the previous file, or home; background closes retain the current selection. Closed files
release their document, composer, and editor state. The
[native registry](../../desktop/src/opening.md) owns stable IDs and watch removal.

Inventory snapshots retain graphical opening errors until dismissal or the next graphical request.
A newer activation revision selects the admitted file; repeated polls preserve manual selection.
Polling never overlaps requests. Native opening, setup, and command errors share the application's
notification host. `close.ts` coalesces window close requests and awaits native termination
cancellation before unlocking the editor. Failed setup confirmation keeps the window available.
Native lifecycle details live beside the [termination adapter](../../desktop/src/termination.md).
The browser entry point retains its own unload prompt and localhost adapter.

`NativeSetup.tsx` holds unconfirmed name and language choices separately from saved configuration.
The native host owns saved-field presence, transient suggestions, and completion; its
[setup contract](../../desktop/src/setup.md) defines the commands. Local edits are
protected immediately while native protection is pending. Language preview does not save settings.
Name validation uses the shared author parser so new comments retain their attribution. Translation
language uses the same searchable picker as Settings, including its Original only choice.

The reviewer stays unmounted until confirmation succeeds and saved configuration reloads. App-level
configuration loading waits for that gate, avoiding an older load overwriting confirmed choices.
File admission, opening controls, activation, and close handling continue during setup. Failed
loading
offers retry; a failed confirmation retains the form. Saved preferences keep computed defaults
distinct from explicit saved choices.

Candidate Enter keeps its IME default while suppressing implicit form submission through the next
task. The [HTML implicit-submission algorithm][implicit-submit] activates the default submit button;
the guard must outlive a microtask. Injected event tests check the guard but do not establish native
Apple Pinyin behavior.

The desktop application lives in [desktop](../../desktop/README.md). Diagnostic observations
and remaining platform checks live in [tools/desktop](../../tools/desktop/README.md).

[implicit-submit]:
  https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#implicit-submission

## Empty home

With no open files after onboarding, the home displays the two-line block-letter wordmark and one
Open Markdown files… control (打开 Markdown 文件… in Chinese). The home button combines the file
icon, label, and platform Open shortcut. The wordmark retains a horizontal slit between its rows.
`home-motion.ts` drifts each complete row independently, sends the rows beyond opposite window
edges when the first file is admitted, and fades the outgoing and incoming screens. Cancelling the
picker or failing to open a file leaves home in place. The last document fades only after saving
and native close succeed; ordinary document switching has no screen transition. The Open button
changes between home and toolbar placement without position animation. Reduced motion skips drift
and screen transitions. Unmount cancels pending animations and animation frames. The native window
drag area remains available in both states.
