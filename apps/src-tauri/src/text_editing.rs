//! Execute standard text edits through AppKit's responder chain, without
//! assigning menu accelerators that would swallow Wisp's file shortcuts.

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeEditAction {
    Copy,
    Cut,
    Paste,
    SelectAll,
    Undo,
    Redo,
}

#[tauri::command]
pub async fn perform_native_edit_action(
    window: tauri::WebviewWindow,
    action: NativeEditAction,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2::{class, msg_send, runtime::AnyObject, sel};

        let (tx, rx) = tokio::sync::oneshot::channel();
        let target_window = window.clone();
        window
            .run_on_main_thread(move || {
                // Do not send a delayed edit to another Wisp window if focus
                // changed while the command was crossing the IPC boundary.
                let result = target_window
                    .ns_window()
                    .map_err(|e| e.to_string())
                    .and_then(|ptr| unsafe {
                        let native_window = ptr.cast::<AnyObject>();
                        let is_key: bool = msg_send![native_window, isKeyWindow];
                        if !is_key {
                            return Err("The text editor's window is no longer focused".to_string());
                        }
                        let selector = match action {
                            NativeEditAction::Copy => sel!(copy:),
                            NativeEditAction::Cut => sel!(cut:),
                            NativeEditAction::Paste => sel!(paste:),
                            NativeEditAction::SelectAll => sel!(selectAll:),
                            NativeEditAction::Undo => sel!(undo:),
                            NativeEditAction::Redo => sel!(redo:),
                        };
                        let app: *mut AnyObject =
                            msg_send![class!(NSApplication), sharedApplication];
                        let handled: bool = msg_send![app,
                            sendAction: selector,
                            to: std::ptr::null::<AnyObject>(),
                            from: std::ptr::null::<AnyObject>()
                        ];
                        if handled {
                            Ok(())
                        } else {
                            Err("The focused editor could not perform this edit".to_string())
                        }
                    });
                let _ = tx.send(result);
            })
            .map_err(|e| e.to_string())?;
        rx.await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, action);
        Err("Native edit forwarding is only needed on macOS".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_standard_edit_actions_are_accepted() {
        for action in ["copy", "cut", "paste", "select_all", "undo", "redo"] {
            assert!(serde_json::from_value::<NativeEditAction>(serde_json::json!(action)).is_ok());
        }
        for action in ["delete", "Copy", "copy:", "terminate:"] {
            assert!(serde_json::from_value::<NativeEditAction>(serde_json::json!(action)).is_err());
        }
    }
}
