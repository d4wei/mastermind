# Native background synchronization

`ThemeEffects` synchronizes the native background when the theme stylesheet loads, including an
already-loaded startup stylesheet. Its transition fallback only removes the veil; it does not send
a color before the stylesheet is ready. CSS tokens remain the color authority.

`background.ts` samples the root's computed background through an sRGB canvas. This uses the
browser's color conversion for OKLCH and other CSS color forms rather than maintaining a second
parser or palette. Browser hosts omit the optional `ReviewerHost.setBackgroundColor` operation.
The native adapter sends the resulting RGBA bytes to `desktop/src/appearance.rs`.

On macOS, the command calls WKWebView's public [`setUnderPageBackgroundColor:`][under-page] on the
UI thread. The title bar keeps its system appearance. A selector check preserves startup on older
macOS versions without that API; their under-page background remains system-managed. Other desktop
platforms use Tauri's window and webview background setters. No scroll behavior is disabled.

Tests cover stylesheet timing, theme changes, startup synchronization, and the host payload.
The canvas conversion and elastic-scroll appearance require native visual checks; jsdom cannot
render them. The manual checklist lives in `tests/manual/review-interactions.md`.

[under-page]: https://developer.apple.com/documentation/webkit/wkwebview/underpagebackgroundcolor
