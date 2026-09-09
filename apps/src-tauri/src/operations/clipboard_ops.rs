use tauri::command;

/// Put file URLs on the system clipboard the same way Finder's ⌘C does, so
/// other apps (WeChat, Mail, browsers…) accept ⌘V as file attachments.
/// NSPasteboard must be touched on the MAIN thread — from a tokio worker the
/// calls silently no-op (clearContents included), which is why ⌘V elsewhere
/// pasted nothing even though the app showed 已复制.
#[cfg(target_os = "macos")]
#[command]
pub async fn copy_files_to_clipboard(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let send = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let send2 = send.clone();
    let _ = app.run_on_main_thread(move || {
        let result = unsafe {
            let pb = objc2_app_kit::NSPasteboard::generalPasteboard();
            write_file_urls_to_pasteboard(&pb, &paths)
        };
        if let Some(tx) = send2.lock().unwrap().take() {
            let _ = tx.send(result);
        }
    });
    rx.recv()
        .map_err(|e| format!("main-thread pasteboard dispatch failed: {e}"))?
}

#[cfg(target_os = "macos")]
unsafe fn write_file_urls_to_pasteboard(
    pb: &objc2_app_kit::NSPasteboard,
    paths: &[String],
) -> Result<(), String> {
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::NSPasteboardWriting;
    use objc2_foundation::{NSArray, NSString, NSURL};

    // Drop paths that no longer exist: a dead file URL pasted into another app
    // shows up as a broken/empty attachment instead of failing loudly here.
    let urls: Vec<_> = paths
        .iter()
        .filter(|p| std::path::Path::new(p).exists())
        .map(|p| NSURL::fileURLWithPath(&NSString::from_str(p)))
        .collect();
    if urls.is_empty() {
        return Err("No existing files to copy".to_string());
    }

    let objects: Vec<Retained<ProtocolObject<dyn NSPasteboardWriting>>> = urls
        .into_iter()
        .map(|url| ProtocolObject::from_retained(url))
        .collect();

    pb.clearContents();
    let objects = NSArray::from_retained_slice(&objects);
    if !pb.writeObjects(&objects) {
        return Err("Failed to write files to the pasteboard".to_string());
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[command]
pub async fn copy_files_to_clipboard(_paths: Vec<String>) -> Result<(), String> {
    Err("Not supported on this platform".to_string())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn writes_file_url_onto_pasteboard() {
        let tmp = std::env::temp_dir().join("wisp-clipboard-ops-test.txt");
        std::fs::write(&tmp, b"pasteboard test").unwrap();

        // A private named pasteboard keeps the test off the user's real clipboard.
        unsafe {
            let name = objc2_foundation::NSString::from_str("wisp-clipboard-ops-test");
            let pb = objc2_app_kit::NSPasteboard::pasteboardWithName(&name);
            write_file_urls_to_pasteboard(&pb, &[tmp.to_string_lossy().to_string()]).unwrap();

            let items = pb.pasteboardItems().expect("pasteboard items");
            assert_eq!(items.len(), 1);
            let url = items
                .objectAtIndex(0)
                .stringForType(&objc2_foundation::NSString::from_str("public.file-url"))
                .expect("file-url data on item");
            assert!(url.to_string().ends_with("wisp-clipboard-ops-test.txt"));

            // The path must survive as a plain file URL, not percent-mangled.
            assert!(url.to_string().starts_with("file://"));
        }
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn skips_missing_files_and_errors_when_nothing_remains() {
        unsafe {
            let name = objc2_foundation::NSString::from_str("wisp-clipboard-ops-test-missing");
            let pb = objc2_app_kit::NSPasteboard::pasteboardWithName(&name);
            let missing = std::env::temp_dir().join("wisp-does-not-exist-xyz.txt");
            let err = write_file_urls_to_pasteboard(&pb, &[missing.to_string_lossy().to_string()])
                .unwrap_err();
            assert!(err.contains("No existing files"));
        }
    }
}
