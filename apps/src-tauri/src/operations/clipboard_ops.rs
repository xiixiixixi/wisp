use tauri::command;

/// Put file URLs on the system clipboard the same way Finder's ⌘C does, so
/// other apps (WeChat, Mail, browsers…) accept ⌘V as file attachments.
#[cfg(target_os = "macos")]
#[command]
pub async fn copy_files_to_clipboard(paths: Vec<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        unsafe {
            let pb = objc2_app_kit::NSPasteboard::generalPasteboard();
            write_file_urls_to_pasteboard(&pb, &paths)
        }
    })
    .await
    .map_err(|e| e.to_string())?
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
