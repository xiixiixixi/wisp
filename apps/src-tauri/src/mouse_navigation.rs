//! Mouse side-button (back/forward) navigation.
//!
//! WKWebView does not reliably surface auxiliary mouse buttons to the web
//! layer, so an AppKit local event monitor watches OtherMouseUp on the main
//! thread and forwards side-button presses to the frontend as `mouse-back` /
//! `mouse-forward` Tauri events. macOS mouse conventions: buttonNumber 3 =
//! back, 4 = forward.

#[cfg(target_os = "macos")]
pub fn install_mouse_navigation(app_handle: tauri::AppHandle) {
    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventType};
    use std::ptr::NonNull;
    use tauri::Emitter;

    let handle = app_handle.clone();
    unsafe {
        let block: RcBlock<dyn Fn(NonNull<NSEvent>) -> *mut NSEvent> = RcBlock::new(
            move |event: NonNull<NSEvent>| -> *mut NSEvent {
                let event = unsafe { event.as_ref() };
                let consumed = match event.buttonNumber() {
                    3 => {
                        let _ = handle.emit("mouse-back", ());
                        true
                    }
                    4 => {
                        let _ = handle.emit("mouse-forward", ());
                        true
                    }
                    _ => false,
                };
                if consumed {
                    std::ptr::null_mut()
                } else {
                    event as *const NSEvent as *mut NSEvent
                }
            },
        );

        let mask = NSEventMask(1 << NSEventType::OtherMouseUp.0);
        let monitor = NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &block);
        // Intentionally leaked: the monitor and its block must outlive this
        // call for the whole process, and they are not Send/Sync for a static.
        std::mem::forget(block);
        if let Some(token) = monitor {
            std::mem::forget(token);
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn install_mouse_navigation(_app_handle: tauri::AppHandle) {}
