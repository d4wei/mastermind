use objc2::{
    MainThreadMarker, ffi,
    runtime::{AnyClass, AnyObject, Imp, Sel},
    sel,
};
use objc2_app_kit::{NSApplication, NSApplicationTerminateReply};
use std::{
    io,
    sync::{
        OnceLock,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::Emitter;

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static PENDING: AtomicBool = AtomicBool::new(false);
static READY: AtomicBool = AtomicBool::new(false);

extern "C-unwind" fn should_terminate(
    _: &AnyObject,
    _: Sel,
    _: *mut AnyObject,
) -> NSApplicationTerminateReply {
    if !READY.load(Ordering::SeqCst) {
        return NSApplicationTerminateReply::TerminateCancel;
    }
    let Some(app) = APP.get() else {
        return NSApplicationTerminateReply::TerminateCancel;
    };
    if !PENDING.swap(true, Ordering::SeqCst) && app.emit("close-requested", ()).is_err() {
        PENDING.store(false, Ordering::SeqCst);
        return NSApplicationTerminateReply::TerminateCancel;
    }
    NSApplicationTerminateReply::TerminateLater
}

fn add_termination_method(class: &AnyClass) -> io::Result<()> {
    let selector = sel!(applicationShouldTerminate:);
    // An upstream implementation must be reconciled instead of silently overridden on upgrade.
    if class.instance_method(selector).is_some() {
        return Err(io::Error::other(
            "termination_delegate_method_already_exists",
        ));
    }
    // AppKit's signature is NSUInteger (id, SEL, NSApplication *); macOS targets are 64-bit.
    // Only a previously absent method is added; the delegate's layout and other methods stay intact.
    let added = unsafe {
        let implementation: Imp = std::mem::transmute(
            should_terminate
                as extern "C-unwind" fn(
                    &AnyObject,
                    Sel,
                    *mut AnyObject,
                ) -> NSApplicationTerminateReply,
        );
        ffi::class_addMethod(
            class as *const AnyClass as *mut AnyClass,
            selector,
            implementation,
            c"Q@:@".as_ptr(),
        )
    };
    if !added.as_bool() {
        return Err(io::Error::other("termination_delegate_install_failed"));
    }
    Ok(())
}

pub fn install(app: &tauri::AppHandle) -> io::Result<()> {
    let main = MainThreadMarker::new().ok_or_else(|| io::Error::other("not_main_thread"))?;
    let application = NSApplication::sharedApplication(main);
    let delegate = application
        .delegate()
        .ok_or_else(|| io::Error::other("missing_app_delegate"))?;
    let object: &AnyObject = delegate.as_ref();
    if object.class().name() != c"TaoAppDelegateParent" {
        return Err(io::Error::other("unrecognized_app_delegate"));
    }
    APP.set(app.clone())
        .map_err(|_| io::Error::other("termination_already_installed"))?;
    add_termination_method(object.class())?;
    // Refresh AppKit's optional-delegate-method cache after registering the method.
    application.setDelegate(None);
    application.setDelegate(Some(&delegate));
    Ok(())
}

pub fn reply(allowed: bool) -> bool {
    if !PENDING.swap(false, Ordering::SeqCst) {
        return false;
    }
    let main = MainThreadMarker::new().expect("termination replies run on the main thread");
    NSApplication::sharedApplication(main).replyToApplicationShouldTerminate(allowed);
    true
}

pub fn ready() {
    READY.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2::{class, msg_send, runtime::ClassBuilder};

    #[test]
    fn delegate_method_has_the_appkit_abi_and_refuses_replacement() {
        let class = ClassBuilder::new(c"MastermindTerminationTest", class!(NSObject))
            .unwrap()
            .register();
        add_termination_method(class).unwrap();
        // Before the renderer subscribes, a quit cannot wait on an event with no consumer.
        unsafe {
            let object: objc2::rc::Retained<AnyObject> = msg_send![class, new];
            let result: NSApplicationTerminateReply =
                msg_send![&object, applicationShouldTerminate: std::ptr::null_mut::<AnyObject>()];
            assert_eq!(result, NSApplicationTerminateReply::TerminateCancel);
        }
        assert_eq!(
            add_termination_method(class).unwrap_err().to_string(),
            "termination_delegate_method_already_exists"
        );
    }
}
