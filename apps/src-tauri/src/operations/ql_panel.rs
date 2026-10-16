//! In-process system Quick Look panel.
//!
//! Hosts macOS's own `QLPreviewPanel` (the exact surface Finder's space-bar
//! preview uses) inside Wisp — full-document, every page, every format the
//! system can render, with zero dependencies. The controller joins the main
//! window's responder chain, so the panel attaches to the Wisp window like it
//! does in Finder.

use std::cell::RefCell;
use std::sync::Mutex;

use objc2::define_class;
use objc2::msg_send;
use objc2::rc::{autoreleasepool, Retained};
use objc2::__macro_helpers::MaybeOptionRetained;
use std::ffi::CString;
use objc2::{msg_send_id, ClassType, MainThreadMarker, MainThreadOnly};
use objc2::runtime::{AnyClass, AnyObject, NSObject, ProtocolObject};
use objc2_app_kit::{NSApplication, NSResponder, NSView};
use objc2_foundation::{NSBundle, NSString, NSURL};
use tauri::{AppHandle, Manager};

thread_local! {
    /// Per-main-thread controller; AppKit panels must run on the main thread.
    static CONTROLLER: RefCell<Option<Retained<QLController>>> = const { RefCell::new(None) };
}

/// The file the panel should render right now. Written by the Tauri command
/// (any thread), read by the panel's data source callbacks (main thread).
static CURRENT_PATH: Mutex<String> = Mutex::new(String::new());

define_class!(
    #[unsafe(super(NSResponder))]
    #[thread_kind = MainThreadOnly]
    #[name = "WispQLController"]
    struct QLController;

    impl QLController {
        /// The panel asks the responder chain whether anyone wants control.
        #[unsafe(method(acceptsPreviewPanelControl:))]
        unsafe fn accepts_preview_panel_control(&self, _panel: *mut AnyObject) -> bool {
            true
        }

        /// On control, hand the panel our data source.
        #[unsafe(method(beginPreviewPanelControl:))]
        unsafe fn begin_preview_panel_control(&self, panel: *mut AnyObject) {
            let _: () = msg_send![panel, setDataSource: self];
            let _: () = msg_send![panel, setDelegate: self];
            let _: () = msg_send![panel, reloadData];
        }

        #[unsafe(method(numberOfPreviewItemsInPreviewPanel:))]
        unsafe fn number_of_preview_items(&self, _panel: *mut AnyObject) -> isize {
            1
        }

        #[unsafe(method(previewPanel:previewItemAtIndex:))]
        unsafe fn preview_item(
            &self,
            _panel: *mut AnyObject,
            _index: isize,
        ) -> objc2::__macro_helpers::RetainedReturnValue {
            let path = CURRENT_PATH
                .lock()
                .map(|p| p.clone())
                .unwrap_or_default();
            let url = NSURL::fileURLWithPath(&NSString::from_str(&path));
            use objc2::__macro_helpers::MaybeOptionRetained;
            Some(url).autorelease_return()
        }
    }
);

/// Load Quartz.framework (which provides QLPreviewPanel) once.
fn ql_panel_class() -> Option<&'static AnyClass> {
    static LOADED: std::sync::Once = std::sync::Once::new();
    LOADED.call_once(|| {
        autoreleasepool(|_| {
            let bundle = NSBundle::bundleWithPath(
                &NSString::from_str("/System/Library/Frameworks/Quartz.framework"),
            );
            if let Some(bundle) = bundle.as_ref() {
                let _: bool = unsafe { msg_send![bundle, load] };
            }
            None::<()>
        });
    });
    AnyClass::get(CString::new("QLPreviewPanel").ok()?.as_c_str())
}

/// Make our controller part of the main window's responder chain so the
/// panel finds a controller when it becomes key. Idempotent.
fn join_responder_chain(app: &AppHandle, controller: &QLController) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window unavailable")?;
    let ns_window = unsafe {
        Retained::retain(window.ns_window().map_err(|e| e.to_string())?.cast::<objc2_app_kit::NSWindow>())
            .ok_or("invalid NSWindow")?
    };
    let content = unsafe { ns_window.contentView().ok_or("no contentView")? };
    let _: () = unsafe { msg_send![&*content, setNextResponder: controller] };
    Ok(())
}

/// Show the system Quick Look panel for `path`.
pub fn show(app: &AppHandle, path: &str) -> Result<(), String> {
    if !std::path::Path::new(path).exists() {
        return Err("file not found".to_string());
    }
    let cls = ql_panel_class().ok_or("QuickLookUI framework unavailable")?;

    *CURRENT_PATH.lock().map_err(|_| "path lock poisoned")? = path.to_string();

    NSApplication::sharedApplication(mtm_from_app(app));

    CONTROLLER.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            // MainThreadOnly type: constructing here (main thread) is sound.
            // ClassType::class() registers the class with the ObjC runtime on
            // first call — it must run before any class! lookup of the name.
            let controller_class = <QLController as ClassType>::class();
            let controller: Retained<QLController> =
                unsafe { msg_send![controller_class, new] };
            *slot = Some(controller);
        }
        let controller = slot.as_ref().unwrap();
        join_responder_chain(app, controller)?;

        let panel: Retained<AnyObject> = unsafe { msg_send![cls, sharedPreviewPanel] };
        unsafe {
            let nil = std::ptr::null_mut::<AnyObject>();
            let _: () = msg_send![&panel, makeKeyAndOrderFront: nil];
        }
        Ok(())
    })
}

fn mtm_from_app(_app: &AppHandle) -> objc2::MainThreadMarker {
    // The command runs on the main thread via run_on_main_thread.
    unsafe { objc2::MainThreadMarker::new_unchecked() }
}

/// Tauri command: show the system Quick Look panel for a path.
#[tauri::command]
pub async fn preview_open_ql_panel(app: AppHandle, path: String) -> Result<(), String> {
    let handle = app.clone();
    let path2 = path.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(show(&handle, &path2));
    });
    rx.recv().map_err(|_| "main thread dispatch failed".to_string())?
}
