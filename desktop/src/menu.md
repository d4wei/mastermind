# Native menu

`menu.rs` owns the application menu bar: its layout per platform, its English and Chinese labels,
which items are enabled or checked, and where each activation goes. The renderer owns what an
action does to a document.

## Labels and language

One label table names every entry, submenu titles and predefined items included, in English and
Simplified Chinese per [the terminology](../../docs/terminology.md). The menu starts in English.
`set_menu_language({ lang })` takes the interface language code (`en` or `zh-CN`) and resets every
entry's text; the renderer sends it when its configuration loads, when the Interface language
changes, and while setup previews a language.

Predefined items keep the key bindings the pinned muda fixes for them. Its Close Window item binds
Cmd+W, which Close File takes here, so Close Window is a custom item on Cmd+Shift+W that closes the
window through the same close request as the window's own button.

## State

`set_menu_state({ documentActive, mode, commentsAvailable, commentsOpen })` reports the renderer's
view. `mode` is the document store's `reading` or `source`. Settings…, Close File, Save As…, Find…,
Read, Markdown, and Resolved discussions are enabled only while a document is active; Comments also
needs comments to be available in the current view. Read and Markdown are checked by mode, and
Comments by whether the rail is showing. The platform toggles a clicked check item by itself, so a
click reapplies the last reported state; the renderer's next report then carries any change.

## Activation

Settings…, Close File, Save As…, Read, Markdown, Comments, and Resolved discussions emit one
`menu-action` event whose payload names the item: `settings`, `close-file`, `save-copy`,
`view-read`, `view-markdown`, `toggle-comments`, or `resolved`. Find… emits `find-requested`; Quit
on platforms without the predefined item emits `close-requested`; Open Markdown files… opens the
native picker. The [UI adapter](../../ui/desktop/README.md) dispatches the renderer's actions.
There is no Help menu: the app opens no browser and makes no network requests.
