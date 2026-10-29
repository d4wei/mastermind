#[cfg(target_os = "macos")]
mod macos;

pub fn install(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    macos::install(app)?;
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

pub fn complete(app: tauri::AppHandle, allowed: bool) -> tauri::Result<()> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        if macos::reply(allowed) {
            return;
        }
        if allowed {
            handle.exit(0);
        }
    })
}

#[tauri::command]
pub fn close_ready() {
    #[cfg(target_os = "macos")]
    macos::ready();
}

pub fn renderer_lost(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        macos::disarm();
        let _ = complete(app.clone(), false);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// How many lost renderers one host reloads before leaving the window blank.
pub const RENDERER_RELOAD_LIMIT: u32 = 3;

/// Whether to reload after a lost renderer. A document that crashes the web content process on
/// every load would otherwise reload forever; past the limit the window stays blank and quitting
/// still works, since an unsubscribed renderer never defers termination.
pub fn should_reload_renderer(reloads: &std::sync::atomic::AtomicU32) -> bool {
    reloads.fetch_add(1, std::sync::atomic::Ordering::SeqCst) < RENDERER_RELOAD_LIMIT
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU32;

    #[test]
    fn renderer_reloads_stop_at_the_limit() {
        let reloads = AtomicU32::new(0);
        for _ in 0..RENDERER_RELOAD_LIMIT {
            assert!(should_reload_renderer(&reloads));
        }
        assert!(!should_reload_renderer(&reloads));
        assert!(!should_reload_renderer(&reloads));
    }
}
