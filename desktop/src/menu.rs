use serde::Deserialize;
use std::sync::Mutex;
use tauri::menu::{
    AboutMetadata, CheckMenuItem, IsMenuItem, Menu, MenuEvent, MenuItem, MenuItemKind,
    PredefinedMenuItem, Submenu,
};
use tauri::{AppHandle, Emitter, Manager, Wry};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
pub enum Language {
    #[default]
    #[serde(rename = "en")]
    English,
    #[serde(rename = "zh-CN")]
    Chinese,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Predefined {
    About,
    Services,
    Hide,
    HideOthers,
    ShowAll,
    Quit,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Fullscreen,
    Minimize,
    Zoom,
    BringAllToFront,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Submenu,
    /// A custom item with its accelerator; [`dispatch`] routes its activation.
    Action(Option<&'static str>),
    /// A custom check item; [`item_states`] owns its check.
    Check,
    Predefined(Predefined),
}

struct Label {
    id: &'static str,
    en: &'static str,
    zh: &'static str,
    kind: Kind,
}

impl Label {
    fn text(&self, language: Language) -> &'static str {
        match language {
            Language::English => self.en,
            Language::Chinese => self.zh,
        }
    }
}

const fn label(id: &'static str, en: &'static str, zh: &'static str, kind: Kind) -> Label {
    Label { id, en, zh, kind }
}

/// Every labelled menu entry. Chinese labels follow `docs/terminology.md`.
const LABELS: &[Label] = &[
    label("application", "mastermind", "mastermind", Kind::Submenu),
    label(
        "about",
        "About mastermind",
        "关于 mastermind",
        Kind::Predefined(Predefined::About),
    ),
    label(
        "settings",
        "Settings…",
        "设置…",
        Kind::Action(Some("CmdOrCtrl+,")),
    ),
    label(
        "services",
        "Services",
        "服务",
        Kind::Predefined(Predefined::Services),
    ),
    label(
        "hide",
        "Hide mastermind",
        "隐藏 mastermind",
        Kind::Predefined(Predefined::Hide),
    ),
    label(
        "hide-others",
        "Hide Others",
        "隐藏其他",
        Kind::Predefined(Predefined::HideOthers),
    ),
    label(
        "show-all",
        "Show All",
        "全部显示",
        Kind::Predefined(Predefined::ShowAll),
    ),
    label(
        "quit",
        "Quit mastermind",
        "退出 mastermind",
        Kind::Predefined(Predefined::Quit),
    ),
    label(
        "quit-reviewer",
        "Quit mastermind",
        "退出 mastermind",
        Kind::Action(Some("CmdOrCtrl+Q")),
    ),
    label("file", "File", "文件", Kind::Submenu),
    label(
        "open-files",
        "Open Markdown files…",
        "打开 Markdown 文件…",
        Kind::Action(Some("CmdOrCtrl+O")),
    ),
    label(
        "close-file",
        "Close File",
        "关闭文件",
        Kind::Action(Some("CmdOrCtrl+W")),
    ),
    label(
        "save-copy",
        "Save As…",
        "另存为…",
        Kind::Action(Some("CmdOrCtrl+Shift+S")),
    ),
    label(
        "close-window",
        "Close Window",
        "关闭窗口",
        Kind::Action(Some("CmdOrCtrl+Shift+W")),
    ),
    label("edit", "Edit", "编辑", Kind::Submenu),
    label("undo", "Undo", "撤销", Kind::Predefined(Predefined::Undo)),
    label("redo", "Redo", "重做", Kind::Predefined(Predefined::Redo)),
    label("cut", "Cut", "剪切", Kind::Predefined(Predefined::Cut)),
    label("copy", "Copy", "复制", Kind::Predefined(Predefined::Copy)),
    label(
        "paste",
        "Paste",
        "粘贴",
        Kind::Predefined(Predefined::Paste),
    ),
    label(
        "select-all",
        "Select All",
        "全选",
        Kind::Predefined(Predefined::SelectAll),
    ),
    label(
        "find-document",
        "Find…",
        "查找…",
        Kind::Action(Some("CmdOrCtrl+F")),
    ),
    label("view", "View", "查看", Kind::Submenu),
    label("view-read", "Read", "阅读", Kind::Check),
    label("view-markdown", "Markdown", "Markdown", Kind::Check),
    label("toggle-comments", "Comments", "评论", Kind::Check),
    label(
        "resolved",
        "Resolved discussions",
        "已解决的讨论",
        Kind::Action(None),
    ),
    label(
        "fullscreen",
        "Enter Full Screen",
        "进入全屏幕",
        Kind::Predefined(Predefined::Fullscreen),
    ),
    label("window", "Window", "窗口", Kind::Submenu),
    label(
        "minimize",
        "Minimize",
        "最小化",
        Kind::Predefined(Predefined::Minimize),
    ),
    label("zoom", "Zoom", "缩放", Kind::Predefined(Predefined::Zoom)),
    label(
        "bring-all-to-front",
        "Bring All to Front",
        "前置全部窗口",
        Kind::Predefined(Predefined::BringAllToFront),
    ),
];

fn find_label(id: &str) -> &'static Label {
    // `layout_ids_have_labels_and_every_label_is_placed` checks every id the layout names.
    LABELS
        .iter()
        .find(|label| label.id == id)
        .unwrap_or_else(|| panic!("menu entry {id} has no label"))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Entry {
    Item(&'static str),
    Separator,
}

/// The menu bar for one platform: each submenu's label id with its entries.
fn layout(macos: bool) -> Vec<(&'static str, Vec<Entry>)> {
    use Entry::{Item, Separator};
    let mut application = vec![Item("about"), Separator, Item("settings"), Separator];
    if macos {
        application.extend([
            Item("services"),
            Separator,
            Item("hide"),
            Item("hide-others"),
            Item("show-all"),
            Separator,
            Item("quit"),
        ]);
    } else {
        application.push(Item("quit-reviewer"));
    }
    let mut file = vec![Item("open-files"), Item("close-file"), Item("save-copy")];
    // The predefined Close Window item binds Cmd+W, which belongs to Close File here.
    if macos {
        file.extend([Separator, Item("close-window")]);
    }
    let mut edit = Vec::new();
    if macos {
        edit.extend([Item("undo"), Item("redo"), Separator]);
    }
    edit.extend([
        Item("cut"),
        Item("copy"),
        Item("paste"),
        Item("select-all"),
        Separator,
        Item("find-document"),
    ]);
    let mut view = vec![
        Item("view-read"),
        Item("view-markdown"),
        Separator,
        Item("toggle-comments"),
        Item("resolved"),
    ];
    if macos {
        view.extend([Separator, Item("fullscreen")]);
    }
    let mut bar = vec![
        ("application", application),
        ("file", file),
        ("edit", edit),
        ("view", view),
    ];
    if macos {
        bar.push((
            "window",
            vec![
                Item("minimize"),
                Item("zoom"),
                Separator,
                Item("bring-all-to-front"),
            ],
        ));
    }
    bar
}

/// The renderer's view of the active document, as `set_menu_state` receives it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Reading,
    Source,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MenuState {
    pub document_active: bool,
    pub mode: Mode,
    pub comments_available: bool,
    pub comments_open: bool,
}

#[derive(Debug, PartialEq, Eq)]
struct ItemState {
    id: &'static str,
    enabled: bool,
    checked: Option<bool>,
}

/// Enabled and checked states of the items that act on the active document. The mode checks
/// follow the store's mode even without a document, since the store keeps one mode for all.
fn item_states(state: MenuState) -> [ItemState; 8] {
    let active = state.document_active;
    let item = |id, enabled, checked| ItemState {
        id,
        enabled,
        checked,
    };
    [
        item("settings", active, None),
        item("close-file", active, None),
        item("save-copy", active, None),
        item("find-document", active, None),
        item("view-read", active, Some(state.mode == Mode::Reading)),
        item("view-markdown", active, Some(state.mode == Mode::Source)),
        item(
            "toggle-comments",
            active && state.comments_available,
            Some(active && state.comments_available && state.comments_open),
        ),
        item("resolved", active, None),
    ]
}

/// What a custom item's activation does.
#[derive(Debug, PartialEq, Eq)]
enum Dispatch {
    /// Emitted as the `menu-action` event, whose payload is this action.
    Renderer(&'static str),
    /// Emitted as a payload-less event the renderer already handles.
    Event(&'static str),
    ChooseFiles,
    CloseWindow,
}

fn dispatch(id: &str) -> Option<Dispatch> {
    const RENDERER_ACTIONS: [&str; 7] = [
        "settings",
        "close-file",
        "save-copy",
        "view-read",
        "view-markdown",
        "toggle-comments",
        "resolved",
    ];
    if let Some(action) = RENDERER_ACTIONS.into_iter().find(|action| *action == id) {
        return Some(Dispatch::Renderer(action));
    }
    match id {
        "open-files" => Some(Dispatch::ChooseFiles),
        "find-document" => Some(Dispatch::Event("find-requested")),
        "quit-reviewer" => Some(Dispatch::Event("close-requested")),
        "close-window" => Some(Dispatch::CloseWindow),
        _ => None,
    }
}

/// The built menu's labelled entries, so language and state changes reach items in submenus.
pub struct MenuHandles {
    entries: Vec<(&'static str, MenuItemKind<Wry>)>,
    /// The renderer's latest state, reapplied after a click because the platform toggles a
    /// clicked check item on its own.
    state: Mutex<MenuState>,
}

impl MenuHandles {
    fn get(&self, id: &str) -> Option<&MenuItemKind<Wry>> {
        self.entries
            .iter()
            .find(|(entry, _)| *entry == id)
            .map(|(_, item)| item)
    }

    fn set_language(&self, language: Language) -> tauri::Result<()> {
        for (id, item) in &self.entries {
            let text = find_label(id).text(language);
            match item {
                MenuItemKind::MenuItem(item) => item.set_text(text)?,
                MenuItemKind::Submenu(item) => item.set_text(text)?,
                MenuItemKind::Predefined(item) => item.set_text(text)?,
                MenuItemKind::Check(item) => item.set_text(text)?,
                MenuItemKind::Icon(item) => item.set_text(text)?,
            }
        }
        Ok(())
    }

    fn apply(&self, state: MenuState) -> tauri::Result<()> {
        *self.state.lock().unwrap() = state;
        for item in item_states(state) {
            match self.get(item.id) {
                Some(MenuItemKind::MenuItem(menu_item)) => menu_item.set_enabled(item.enabled)?,
                Some(MenuItemKind::Check(check)) => {
                    check.set_enabled(item.enabled)?;
                    check.set_checked(item.checked.unwrap_or(false))?;
                }
                _ => {}
            }
        }
        Ok(())
    }
}

fn predefined(
    app: &AppHandle,
    kind: Predefined,
    text: &str,
) -> tauri::Result<PredefinedMenuItem<Wry>> {
    let text = Some(text);
    match kind {
        Predefined::About => {
            let info = app.package_info();
            let metadata = AboutMetadata {
                name: Some(info.name.clone()),
                version: Some(info.version.to_string()),
                ..Default::default()
            };
            PredefinedMenuItem::about(app, text, Some(metadata))
        }
        Predefined::Services => PredefinedMenuItem::services(app, text),
        Predefined::Hide => PredefinedMenuItem::hide(app, text),
        Predefined::HideOthers => PredefinedMenuItem::hide_others(app, text),
        Predefined::ShowAll => PredefinedMenuItem::show_all(app, text),
        Predefined::Quit => PredefinedMenuItem::quit(app, text),
        Predefined::Undo => PredefinedMenuItem::undo(app, text),
        Predefined::Redo => PredefinedMenuItem::redo(app, text),
        Predefined::Cut => PredefinedMenuItem::cut(app, text),
        Predefined::Copy => PredefinedMenuItem::copy(app, text),
        Predefined::Paste => PredefinedMenuItem::paste(app, text),
        Predefined::SelectAll => PredefinedMenuItem::select_all(app, text),
        Predefined::Fullscreen => PredefinedMenuItem::fullscreen(app, text),
        Predefined::Minimize => PredefinedMenuItem::minimize(app, text),
        Predefined::Zoom => PredefinedMenuItem::maximize(app, text),
        Predefined::BringAllToFront => PredefinedMenuItem::bring_all_to_front(app, text),
    }
}

fn item(app: &AppHandle, label: &Label, language: Language) -> tauri::Result<MenuItemKind<Wry>> {
    let text = label.text(language);
    Ok(match label.kind {
        Kind::Action(accelerator) => {
            MenuItem::with_id(app, label.id, text, true, accelerator)?.kind()
        }
        Kind::Check => {
            CheckMenuItem::with_id(app, label.id, text, true, false, None::<&str>)?.kind()
        }
        Kind::Predefined(kind) => predefined(app, kind, text)?.kind(),
        Kind::Submenu => Submenu::with_id(app, label.id, text, true)?.kind(),
    })
}

/// Builds the menu bar in `language` with no document active.
pub fn build(app: &AppHandle, language: Language) -> tauri::Result<(Menu<Wry>, MenuHandles)> {
    let menu = Menu::new(app)?;
    let mut entries = Vec::new();
    for (submenu_id, items) in layout(cfg!(target_os = "macos")) {
        let submenu = item(app, find_label(submenu_id), language)?;
        let parent = submenu.as_submenu_unchecked();
        for entry in items {
            match entry {
                Entry::Separator => parent.append(&PredefinedMenuItem::separator(app)?)?,
                Entry::Item(id) => {
                    let child = item(app, find_label(id), language)?;
                    parent.append(&child)?;
                    entries.push((id, child));
                }
            }
        }
        #[cfg(target_os = "macos")]
        if submenu_id == "window" {
            parent.set_as_windows_menu_for_nsapp()?;
        }
        menu.append(&submenu)?;
        entries.push((submenu_id, submenu));
    }
    let handles = MenuHandles {
        entries,
        state: Mutex::default(),
    };
    handles.apply(MenuState::default())?;
    Ok((menu, handles))
}

#[tauri::command]
pub fn set_menu_language(
    handles: tauri::State<'_, MenuHandles>,
    lang: Language,
) -> Result<(), String> {
    handles
        .set_language(lang)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_menu_state(
    handles: tauri::State<'_, MenuHandles>,
    document_active: bool,
    mode: Mode,
    comments_available: bool,
    comments_open: bool,
) -> Result<(), String> {
    handles
        .apply(MenuState {
            document_active,
            mode,
            comments_available,
            comments_open,
        })
        .map_err(|error| error.to_string())
}

pub fn menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    match dispatch(id) {
        Some(Dispatch::Renderer(action)) => {
            let _ = app.emit("menu-action", action);
        }
        Some(Dispatch::Event(name)) => {
            let _ = app.emit(name, ());
        }
        Some(Dispatch::ChooseFiles) => crate::opening::choose_files(app.clone()),
        Some(Dispatch::CloseWindow) => {
            // Closing raises CloseRequested, which asks the renderer like the window's own button.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        }
        None => {}
    }
    if LABELS
        .iter()
        .any(|label| label.id == id && label.kind == Kind::Check)
        && let Some(handles) = app.try_state::<MenuHandles>()
    {
        let state = *handles.state.lock().unwrap();
        let _ = handles.apply(state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn custom_accelerators(macos: bool) -> Vec<&'static str> {
        layout(macos)
            .into_iter()
            .flat_map(|(_, entries)| entries)
            .filter_map(|entry| match entry {
                Entry::Item(id) => match find_label(id).kind {
                    Kind::Action(accelerator) => accelerator,
                    _ => None,
                },
                Entry::Separator => None,
            })
            .collect()
    }

    #[test]
    fn every_label_has_both_languages_and_a_unique_id() {
        let mut ids = HashSet::new();
        for label in LABELS {
            assert!(ids.insert(label.id), "{} repeats", label.id);
            for language in [Language::English, Language::Chinese] {
                let text = label.text(language);
                assert!(!text.trim().is_empty(), "{} lacks {language:?}", label.id);
            }
        }
        assert_eq!(find_label("close-file").text(Language::Chinese), "关闭文件");
        assert_eq!(find_label("save-copy").text(Language::Chinese), "另存为…");
        assert_eq!(
            find_label("resolved").text(Language::Chinese),
            "已解决的讨论"
        );
    }

    #[test]
    fn layout_ids_have_labels_and_every_label_is_placed() {
        let mut placed = HashSet::new();
        for macos in [true, false] {
            for (submenu, entries) in layout(macos) {
                assert_eq!(find_label(submenu).kind, Kind::Submenu);
                placed.insert(submenu);
                for entry in entries {
                    if let Entry::Item(id) = entry {
                        assert_ne!(find_label(id).kind, Kind::Submenu, "{id}");
                        placed.insert(id);
                    }
                }
            }
        }
        for label in LABELS {
            assert!(placed.contains(label.id), "{} is never placed", label.id);
        }
    }

    #[test]
    fn separators_only_divide_groups() {
        for macos in [true, false] {
            for (submenu, entries) in layout(macos) {
                assert_ne!(entries.first(), Some(&Entry::Separator), "{submenu}");
                assert_ne!(entries.last(), Some(&Entry::Separator), "{submenu}");
                assert!(
                    !entries
                        .windows(2)
                        .any(|pair| pair == [Entry::Separator, Entry::Separator]),
                    "{submenu}"
                );
            }
        }
    }

    #[test]
    fn accelerators_are_unique_including_fixed_platform_bindings() {
        // Bindings the pinned muda assigns to the predefined items placed on macOS.
        let fixed = [
            "CmdOrCtrl+Q",
            "CmdOrCtrl+H",
            "CmdOrCtrl+Alt+H",
            "CmdOrCtrl+Z",
            "CmdOrCtrl+Shift+Z",
            "CmdOrCtrl+X",
            "CmdOrCtrl+C",
            "CmdOrCtrl+V",
            "CmdOrCtrl+A",
            "Cmd+Ctrl+F",
            "CmdOrCtrl+M",
        ];
        for macos in [true, false] {
            let mut seen = HashSet::new();
            if macos {
                seen.extend(fixed);
            }
            for accelerator in custom_accelerators(macos) {
                assert!(seen.insert(accelerator), "{accelerator} repeats");
            }
        }
        assert!(custom_accelerators(true).contains(&"CmdOrCtrl+,"));
    }

    #[test]
    fn every_custom_item_dispatches() {
        for label in LABELS {
            if matches!(label.kind, Kind::Action(_) | Kind::Check) {
                assert!(dispatch(label.id).is_some(), "{} does nothing", label.id);
            }
        }
        assert_eq!(
            dispatch("toggle-comments"),
            Some(Dispatch::Renderer("toggle-comments"))
        );
        assert_eq!(
            dispatch("find-document"),
            Some(Dispatch::Event("find-requested"))
        );
        assert_eq!(
            dispatch("quit-reviewer"),
            Some(Dispatch::Event("close-requested"))
        );
        assert_eq!(dispatch("open-files"), Some(Dispatch::ChooseFiles));
        assert_eq!(dispatch("close-window"), Some(Dispatch::CloseWindow));
        assert_eq!(dispatch("about"), None);
    }

    #[test]
    fn state_enables_document_items_only_while_a_document_is_active() {
        let states = |state| item_states(state).map(|item| (item.id, item.enabled, item.checked));
        let idle = states(MenuState::default());
        assert!(idle.iter().all(|(_, enabled, _)| !enabled));
        assert!(idle.contains(&("view-read", false, Some(true))));
        assert!(idle.contains(&("toggle-comments", false, Some(false))));

        let reading = MenuState {
            document_active: true,
            mode: Mode::Reading,
            comments_available: true,
            comments_open: true,
        };
        let active = states(reading);
        assert!(active.iter().all(|(_, enabled, _)| *enabled));
        assert!(active.contains(&("view-read", true, Some(true))));
        assert!(active.contains(&("view-markdown", true, Some(false))));
        assert!(active.contains(&("toggle-comments", true, Some(true))));

        let source = states(MenuState {
            mode: Mode::Source,
            comments_available: false,
            ..reading
        });
        assert!(source.contains(&("view-read", true, Some(false))));
        assert!(source.contains(&("view-markdown", true, Some(true))));
        assert!(source.contains(&("toggle-comments", false, Some(false))));
        assert!(source.contains(&("find-document", true, None)));
    }

    #[test]
    fn state_items_are_custom_entries() {
        for item in item_states(MenuState::default()) {
            let kind = find_label(item.id).kind;
            assert_eq!(
                item.checked.is_some(),
                kind == Kind::Check,
                "{} check mismatch",
                item.id
            );
            assert!(matches!(kind, Kind::Action(_) | Kind::Check), "{}", item.id);
        }
    }

    #[test]
    fn languages_deserialize_from_interface_codes() {
        let parse = |code: &str| serde_json::from_value::<Language>(serde_json::json!(code));
        assert_eq!(parse("en").unwrap(), Language::English);
        assert_eq!(parse("zh-CN").unwrap(), Language::Chinese);
        assert!(parse("fr").is_err());
        assert_eq!(
            serde_json::from_value::<Mode>(serde_json::json!("source")).unwrap(),
            Mode::Source
        );
    }
}
