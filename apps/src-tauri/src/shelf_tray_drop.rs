//! The Wisp-owned status item accepts references to local files, never moves them.
use objc2::rc::{Retained, Weak};
use objc2::runtime::{NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSDragOperation, NSDraggingDestination, NSDraggingInfo, NSEvent,
    NSImage, NSStatusItem, NSView,
};
use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize, NSString};

struct DropIvars {
    app: tauri::AppHandle,
    status: Weak<NSStatusItem>,
}

define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "WispShelfStatusDropView"]
    #[ivars = DropIvars]
    struct StatusDropView;

    unsafe impl NSObjectProtocol for StatusDropView {}

    impl StatusDropView {
        #[unsafe(method(mouseDown:))]
        fn mouse_down(&self, _event: &NSEvent) { self.open_menu(); }

        #[unsafe(method(rightMouseDown:))]
        fn right_mouse_down(&self, _event: &NSEvent) { self.open_menu(); }
    }

    unsafe impl NSDraggingDestination for StatusDropView {
        #[unsafe(method(draggingEntered:))]
        fn dragging_entered(&self, sender: &ProtocolObject<dyn NSDraggingInfo>) -> NSDragOperation {
            self.drag_operation(sender)
        }

        #[unsafe(method(draggingUpdated:))]
        fn dragging_updated(&self, sender: &ProtocolObject<dyn NSDraggingInfo>) -> NSDragOperation {
            self.drag_operation(sender)
        }

        #[unsafe(method(draggingExited:))]
        fn dragging_exited(&self, _sender: Option<&ProtocolObject<dyn NSDraggingInfo>>) { self.highlight(false); }

        #[unsafe(method(prepareForDragOperation:))]
        fn prepare_drag(&self, sender: &ProtocolObject<dyn NSDraggingInfo>) -> bool { self.paths(sender).is_some() }

        #[unsafe(method(performDragOperation:))]
        fn perform_drag(&self, sender: &ProtocolObject<dyn NSDraggingInfo>) -> bool {
            self.highlight(false);
            if let Some(paths) = self.paths(sender) {
                crate::shelf::dispatch_menu_request(&self.ivars().app, serde_json::json!({"action": "addFiles", "paths": paths}));
                true
            } else { false }
        }

        #[unsafe(method(draggingEnded:))]
        fn dragging_ended(&self, _sender: &ProtocolObject<dyn NSDraggingInfo>) { self.highlight(false); }
    }
);

impl StatusDropView {
    fn new(
        mtm: MainThreadMarker,
        app: tauri::AppHandle,
        status: &Retained<NSStatusItem>,
        frame: NSRect,
    ) -> Retained<Self> {
        let allocated = Self::alloc(mtm).set_ivars(DropIvars {
            app,
            status: Weak::from_retained(status),
        });
        unsafe { msg_send![super(allocated), initWithFrame: frame] }
    }

    fn highlight(&self, active: bool) {
        if let Some(button) = self
            .ivars()
            .status
            .load()
            .and_then(|status| status.button(self.mtm()))
        {
            button.highlight(active);
        }
    }

    fn open_menu(&self) {
        if let Some(status) = self.ivars().status.load() {
            if let (Some(menu), Some(button)) = (status.menu(self.mtm()), status.button(self.mtm()))
            {
                button.highlight(true);
                menu.popUpMenuPositioningItem_atLocation_inView(
                    None,
                    NSPoint::new(0.0, button.bounds().size.height),
                    Some(&button),
                );
                button.highlight(false);
            }
        }
    }

    fn drag_operation(&self, sender: &ProtocolObject<dyn NSDraggingInfo>) -> NSDragOperation {
        let accepted = self.paths(sender).is_some();
        self.highlight(accepted);
        if accepted {
            NSDragOperation::Copy
        } else {
            NSDragOperation::None
        }
    }

    fn paths(&self, sender: &ProtocolObject<dyn NSDraggingInfo>) -> Option<Vec<String>> {
        if !super::shelves::state()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .snapshot
            .supported
        {
            return None;
        }
        if !sender
            .draggingSourceOperationMask()
            .contains(NSDragOperation::Copy)
        {
            return None;
        }
        let pasteboard = sender.draggingPasteboard();
        let items = pasteboard.pasteboardItems()?;
        if items.is_empty() || items.len() > 256 {
            return None;
        }
        let file_type = NSString::from_str("public.file-url");
        let urls: Option<Vec<String>> = items
            .iter()
            .map(|item| item.stringForType(&file_type).map(|url| url.to_string()))
            .collect();
        crate::shelf::tray_file_paths(&urls?).ok()
    }
}

pub(super) fn install(app: &tauri::AppHandle, tray: &tauri::tray::TrayIcon) -> tauri::Result<()> {
    let app = app.clone();
    tray.with_inner_tray_icon(move |tray| {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Some(status) = tray.ns_status_item() else {
            return;
        };
        let Some(button) = status.button(mtm) else {
            return;
        };
        if let Some(image) = NSImage::imageWithSystemSymbolName_accessibilityDescription(
            &NSString::from_str("tray"),
            Some(&NSString::from_str("Wisp")),
        ) {
            image.setTemplate(true);
            image.setSize(NSSize::new(18.0, 18.0));
            button.setImage(Some(&image));
            button.setTitle(&NSString::from_str(""));
        }
        let drop = StatusDropView::new(mtm, app, &status, button.bounds());
        drop.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        drop.registerForDraggedTypes(&NSArray::from_retained_slice(&[NSString::from_str(
            "public.file-url",
        )]));
        drop.setToolTip(Some(&NSString::from_str("Wisp")));
        button.addSubview(&drop);
    })?;
    Ok(())
}
