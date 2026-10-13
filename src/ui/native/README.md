# Native reviewer adapter

`main.tsx` installs the native host before mounting the existing React reviewer. `host.ts` adapts
Tauri commands to `app/host.ts`; structured native failures retain the status used by the document
store's conflict handling. Prepared translations still pass through the shared TypeScript freshness
and source-mapping checks. Theme assets are bundled, and preferences use the experiment's native
application config directory, separate from the existing browser app's preferences.

The active document receives immediate native watcher invalidations and periodic revalidation to
cover silent event loss or a watch left on a replaced parent directory. Healthy watcher registration
uses a five-second interval; registration failure uses a one-second interval. Closing the document
event source releases its listener and timer, including registrations that finish after navigation.
Periodic invalidation skips an interval while that document has native reads in flight, so a slow
read can settle without being superseded by the timer. Reads of other documents do not pause it.
Native watcher events still invalidate immediately. Each revalidation reads and hashes the active
file through the versioned native read path even when contents have not changed. This adds periodic
filesystem and renderer work; it does not repair
the underlying OS watch. The [notify watcher caveat][notify-watch] describes path replacement
behavior.

[notify-watch]: https://docs.rs/notify/8.2.0/notify/trait.Watcher.html#tymethod.watch

`NativeReviewer.tsx` provides a native Open files action and a diagnostic open-file selector.
Inventory snapshots retain graphical opening errors until dismissal or the next graphical request.
A newer activation revision selects the admitted file; repeated polls preserve manual selection.
Polling never overlaps requests. The adapter also subscribes to native close requests. It locks
editing while pending setup confirmation and `store.prepareToClose()` finish, then authorizes exit
only when no retained document has unsaved source, an active save, or a distinct comparison result.
Failed confirmation or document saves keep the window available. `close.ts` coalesces close requests
and awaits native termination cancellation before unlocking the editor. Native lifecycle details live
beside the [termination adapter](../../../tools/native-launch/src/termination.md).
The browser entry point retains its own unload prompt and localhost adapter.

`NativeSetup.tsx` holds unconfirmed Name and language choices separately from saved configuration.
The native host owns saved-field presence, transient suggestions, and completion; its
[setup contract](../../../tools/native-launch/src/setup.md) defines the commands. Local edits are
protected immediately while native protection is pending. Language preview does not save settings.
Name validation uses the shared author parser so new comments retain their attribution.

The reviewer stays unmounted until confirmation succeeds and saved configuration reloads. App-level
configuration loading waits for that gate, avoiding an older load overwriting confirmed choices.
File admission, opening controls, activation, and close handling continue during setup. Failed loading
offers retry; a failed confirmation retains the form. Ordinary settings send only changed fields
to the native host, leaving computed defaults distinct from explicit saved choices.

Candidate Enter keeps its IME default while suppressing implicit form submission through the next
task. The [HTML implicit-submission algorithm][implicit-submit] activates the default submit button;
the guard must outlive a microtask. Injected event tests check the guard but do not establish native
Apple Pinyin behavior.

This entry point belongs to the [native validation build](../../../tools/native-launch/README.md),
not a finished desktop shell. Final navigation and application identity remain outside it.
Its open-file inventory polling is diagnostic. Native observations and remaining
platform/lifecycle gaps live in [the results](../../../tools/native-launch/results.md).

[implicit-submit]:
  https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#implicit-submission
