#[tauri::command]
pub fn set_background_color(webview: tauri::Webview, color: [u8; 4]) -> Result<(), String> {
    let [red, green, blue, alpha] = color;
    #[cfg(target_os = "macos")]
    webview
        .with_webview(move |platform| {
            use objc2::{msg_send, runtime::AnyObject, sel};
            use objc2_app_kit::NSColor;
            // Tauri dispatches this closure on the UI thread and owns the WKWebView for its duration.
            let view = unsafe { &*platform.inner().cast::<AnyObject>() };
            // Older macOS versions lack this public API; leave their default surface rather than use private selectors.
            let supported: bool =
                unsafe { msg_send![view, respondsToSelector: sel!(setUnderPageBackgroundColor:)] };
            if supported {
                let color = NSColor::colorWithSRGBRed_green_blue_alpha(
                    red as f64 / 255.0,
                    green as f64 / 255.0,
                    blue as f64 / 255.0,
                    alpha as f64 / 255.0,
                );
                let _: () = unsafe { msg_send![view, setUnderPageBackgroundColor: &*color] };
            }
        })
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    {
        let native_color = tauri::window::Color(red, green, blue, alpha);
        webview
            .window()
            .set_background_color(Some(native_color))
            .map_err(|e| e.to_string())?;
        webview
            .set_background_color(Some(native_color))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_window_title(webview: tauri::Webview, value: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    webview
        .with_webview(move |platform| {
            use objc2::{msg_send, runtime::AnyObject};
            use objc2_foundation::NSString;
            // Tauri owns these native handles for the duration of this UI-thread closure.
            // AppKit resets traffic lights on title changes; Wry reapplies their inset when drawing.
            let window = unsafe { &*platform.ns_window().cast::<AnyObject>() };
            let view = unsafe { &*platform.inner().cast::<AnyObject>() };
            let title = NSString::from_str(&value);
            let _: () = unsafe { msg_send![window, setTitle: &*title] };
            let parent: *mut AnyObject = unsafe { msg_send![view, superview] };
            let _: () = unsafe { msg_send![parent, setNeedsDisplay: true] };
        })
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    webview
        .window()
        .set_title(&value)
        .map_err(|e| e.to_string())?;
    Ok(())
}
