# Native termination

Window close and application quit ask the React document store to flush pending edits and check all
retained documents. `finish_close` authorizes exit; `cancel_close` keeps the window and buffers.
The UI locks editing while the check is in flight and coalesces repeated requests.

On macOS, the standard Quit item, Dock Quit, and normal system termination use AppKit's
[`applicationShouldTerminate:`][termination] callback. The pinned Tao delegate does not implement
that callback; its `applicationWillTerminate:` notification arrives too late to cancel termination.
Tauri's `ExitRequested` event alone therefore cannot protect unsaved documents on these paths.

`termination/macos.rs` adds the absent callback to the known delegate class using the pinned
`objc2` bindings. It changes neither the delegate object nor its existing methods. Installation
fails if the class changes or already implements the callback, so a framework upgrade must reconcile
this boundary explicitly. This adapter should disappear when the framework provides the hook.

Before the renderer has subscribed, the callback cancels quit rather than waiting on a lost event.
Once subscribed, it returns `NSTerminateLater` while the store checks saves. Completion replies to
AppKit on the main thread with approval or cancellation. Other platforms and macOS window-close
requests use Tauri's exit path after the same store check. Forced process termination, crashes, and power
loss cannot wait for the renderer; this mechanism is not crash recovery.

[termination]: https://developer.apple.com/documentation/appkit/nsapplicationdelegate
