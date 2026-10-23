# Native appearance synchronization

`ThemeEffects` synchronizes the native background and light/dark appearance when the theme
stylesheet loads, including an already-loaded startup stylesheet. Its transition fallback only
removes the veil; it does not send a color before the stylesheet is ready. CSS tokens remain the
color authority. The first configured theme replaces the startup default without a veil; only later
theme choices cross-fade.

`appearance.ts` samples the root's computed background through an sRGB canvas. This uses the
browser's color conversion for OKLCH and other CSS color forms rather than maintaining a second
parser or palette. The native adapter sends the resulting RGBA bytes and the theme CSS’s
`color-scheme` to `desktop/src/appearance.rs`. Tauri applies the native appearance so system
controls follow the selected palette. macOS and Linux apply it app-wide; Windows applies it to the
window. The operating system owns traffic-light colors and their inactive treatment.

On macOS, the command calls WKWebView's public [`setUnderPageBackgroundColor:`][under-page] on the
UI thread. The macOS title bar overlays the themed file toolbar. A selector check preserves startup
on older macOS versions without that API; their under-page background remains system-managed.
Other desktop platforms use Tauri's window and webview background setters. The bounded document
scroller keeps elastic movement inside the reading surface; see [document layout](../app/layout.md).

Tests cover stylesheet timing, theme changes, startup synchronization, and the host payload.
The canvas conversion and elastic-scroll appearance require native visual checks; jsdom cannot
render them. The manual checklist lives in `tests/manual/review-interactions.md`.

[under-page]: https://developer.apple.com/documentation/webkit/wkwebview/underpagebackgroundcolor
