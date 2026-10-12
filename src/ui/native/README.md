# Native reviewer adapter

`main.tsx` installs the native host before mounting the existing React reviewer. `host.ts` adapts
Tauri commands to `app/host.ts`; structured native failures retain the status used by the document
store's conflict handling. Prepared translations still pass through the shared TypeScript freshness
and source-mapping checks. Theme assets are bundled, and preferences use the experiment's native
application config directory, separate from the existing browser app's preferences.

`NativeReviewer.tsx` provides a diagnostic open-file selector and subscribes to native close
requests. It locks editing while `store.prepareToClose()` waits for saves, then authorizes exit
only when no retained document has unsaved source, an active save, or a distinct comparison result.
Failed saves keep the window and buffers available. `close.ts` coalesces repeated close requests.
The browser entry point retains its own unload prompt and localhost adapter.

This entry point belongs to the [native validation build](../../../tools/native-launch/README.md),
not a finished desktop shell. Onboarding, file dialogs, final navigation, and application identity
remain outside it. Its open-file inventory polling is diagnostic. Native observations and remaining
platform/lifecycle gaps live in [the results](../../../tools/native-launch/results.md).
