//! Open AirDrop UI without choosing recipients or reporting a completed transfer.

#[derive(Debug, serde::Serialize)]
pub struct AirDropError {
    pub code: &'static str,
    pub message: String,
}

impl AirDropError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[cfg(any(target_os = "macos", test))]
fn validate_paths(paths: Vec<String>) -> Result<Vec<String>, AirDropError> {
    let mut seen = std::collections::HashSet::new();
    let mut valid = Vec::new();
    for path in paths {
        if path.contains('\0') || !std::path::Path::new(&path).is_absolute() {
            return Err(AirDropError::new(
                "invalid_paths",
                "AirDrop requires absolute local file paths",
            ));
        }
        let metadata = std::fs::metadata(&path).map_err(|error| {
            AirDropError::new("invalid_paths", format!("Cannot access {path}: {error}"))
        })?;
        if !metadata.is_file() && !metadata.is_dir() {
            return Err(AirDropError::new(
                "invalid_paths",
                format!("AirDrop cannot share this file type: {path}"),
            ));
        }
        if seen.insert(path.clone()) {
            valid.push(path);
        }
    }
    Ok(valid)
}

/// `Ok(())` means the UI launch was requested, never that files were sent.
#[tauri::command]
pub async fn open_airdrop(
    window: tauri::WebviewWindow,
    paths: Vec<String>,
) -> Result<(), AirDropError> {
    #[cfg(target_os = "macos")]
    {
        let paths = tokio::task::spawn_blocking(move || validate_paths(paths))
            .await
            .map_err(|error| AirDropError::new("launch_failed", error.to_string()))??;
        let (tx, rx) = tokio::sync::oneshot::channel();
        let source_window = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(macos::open(&source_window, &paths));
            })
            .map_err(|error| AirDropError::new("launch_failed", error.to_string()))?;
        rx.await
            .map_err(|error| AirDropError::new("launch_failed", error.to_string()))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, paths);
        Err(AirDropError::new(
            "unsupported",
            "AirDrop is available only on macOS",
        ))
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::AirDropError;
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSSharingContentScope, NSSharingService, NSSharingServiceDelegate,
        NSSharingServiceNameSendViaAirDrop, NSWindow, NSWorkspace,
    };
    use objc2_foundation::{NSArray, NSError, NSObject, NSObjectProtocol, NSString, NSURL};
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;
    use std::ptr::NonNull;

    struct SharingSession {
        service: Retained<NSSharingService>,
        delegate: Retained<AirDropDelegate>,
        _items: Retained<NSArray>,
        window: Retained<NSWindow>,
    }

    thread_local! {
        // AppKit may call back with a service copy. A delegate belongs to one
        // invocation and carries its own identity, independently of service pointers.
        static NEXT_SESSION: Cell<usize> = const { Cell::new(0) };
        static SESSIONS: RefCell<HashMap<usize, SharingSession>> = RefCell::new(HashMap::new());
    }

    fn service_key(service: &NSSharingService) -> usize {
        service as *const NSSharingService as usize
    }

    fn log_callback(id: usize, service: &NSSharingService, event: &str) {
        let original = SESSIONS.with(|sessions| {
            sessions.borrow().get(&id).map(|session| service_key(&session.service))
        });
        tracing::info!(session_id = id, callback_service = service_key(service), original_service = ?original, event, "AirDrop lifecycle");
    }

    fn finish(id: usize) {
        let session = SESSIONS.with(|sessions| sessions.borrow_mut().remove(&id));
        if let Some(session) = session {
            session.service.setDelegate(None);
            // Keep the callback sender alive until AppKit leaves this event's
            // autorelease pool, rather than releasing its final owner mid-callback.
            let _ = Retained::autorelease_ptr(session.service);
            let _ = Retained::autorelease_ptr(session.delegate);
            tracing::info!(session_id = id, "AirDrop session released");
        }
    }

    struct DelegateIvars {
        session_id: usize,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "WispAirDropDelegate"]
        #[ivars = DelegateIvars]
        struct AirDropDelegate;

        unsafe impl NSObjectProtocol for AirDropDelegate {}

        unsafe impl NSSharingServiceDelegate for AirDropDelegate {
            #[unsafe(method(sharingService:willShareItems:))]
            unsafe fn will_share(&self, service: &NSSharingService, _items: &NSArray) {
                log_callback(self.ivars().session_id, service, "will_share");
            }

            #[unsafe(method(sharingService:didShareItems:))]
            unsafe fn did_share(&self, service: &NSSharingService, _items: &NSArray) {
                log_callback(self.ivars().session_id, service, "did_share");
                finish(self.ivars().session_id);
            }

            #[unsafe(method(sharingService:didFailToShareItems:error:))]
            unsafe fn did_fail(
                &self,
                service: &NSSharingService,
                _items: &NSArray,
                error: &NSError,
            ) {
                // Includes NSUserCancelledError. Cancellation is handled by the
                // system UI and must not be reported as a completed transfer.
                log_callback(self.ivars().session_id, service, "did_fail");
                tracing::info!(session_id = self.ivars().session_id, error_code = error.code(), error_domain = %error.domain(), "AirDrop ended without sharing");
                finish(self.ivars().session_id);
            }

            #[unsafe(method_id(sharingService:sourceWindowForShareItems:sharingContentScope:))]
            unsafe fn source_window(
                &self,
                service: &NSSharingService,
                _items: &NSArray,
                _scope: NonNull<NSSharingContentScope>,
            ) -> Option<Retained<NSWindow>> {
                log_callback(self.ivars().session_id, service, "source_window");
                SESSIONS.with(|sessions| {
                    sessions
                        .borrow()
                        .get(&self.ivars().session_id)
                        .map(|session| session.window.clone())
                })
            }
        }
    );

    pub(super) fn open(
        window: &tauri::WebviewWindow,
        paths: &[String],
    ) -> Result<(), AirDropError> {
        let mtm = MainThreadMarker::new().ok_or_else(|| {
            AirDropError::new("launch_failed", "AirDrop UI must run on the main thread")
        })?;
        if paths.is_empty() {
            let workspace = NSWorkspace::sharedWorkspace();
            // Finder ships this small launcher specifically for its AirDrop page.
            let application = workspace
                .URLForApplicationWithBundleIdentifier(&NSString::from_str(
                    "com.apple.finder.Open-AirDrop",
                ))
                .ok_or_else(|| {
                    AirDropError::new("unavailable", "Finder AirDrop is not installed")
                })?;
            return if workspace.openURL(&application) {
                Ok(())
            } else {
                Err(AirDropError::new(
                    "launch_failed",
                    "Finder could not open AirDrop",
                ))
            };
        }

        if SESSIONS.with(|sessions| !sessions.borrow().is_empty()) {
            SESSIONS.with(|sessions| {
                tracing::info!(active_sessions = ?sessions.borrow().keys().collect::<Vec<_>>(), "AirDrop open blocked by active chooser");
            });
            return Err(AirDropError::new(
                "unavailable",
                "An AirDrop chooser is already open",
            ));
        }

        let ptr = window
            .ns_window()
            .map_err(|error| AirDropError::new("launch_failed", error.to_string()))?;
        // Tauri owns this NSWindow; retain it while it anchors the system chooser.
        let source_window =
            unsafe { Retained::retain(ptr.cast::<NSWindow>()) }.ok_or_else(|| {
                AirDropError::new("launch_failed", "The source window is unavailable")
            })?;
        let service =
            NSSharingService::sharingServiceNamed(unsafe { NSSharingServiceNameSendViaAirDrop })
                .ok_or_else(|| {
                    AirDropError::new("unavailable", "The AirDrop sharing service is unavailable")
                })?;
        let urls: Vec<_> = paths
            .iter()
            .map(|path| NSURL::fileURLWithPath(&NSString::from_str(path)))
            .collect();
        // NSArray is covariant; every item is an NSURL and conforms to NSPasteboardWriting.
        let items: Retained<NSArray> =
            unsafe { Retained::cast_unchecked(NSArray::from_retained_slice(&urls)) };
        if !unsafe { service.canPerformWithItems(Some(&items)) } {
            tracing::warn!(item_count = paths.len(), "AirDrop canPerformWithItems rejected selection");
            return Err(AirDropError::new(
                "unavailable",
                "AirDrop cannot share the selected files",
            ));
        }
        let id = NEXT_SESSION.with(|next| {
            let id = next.get() + 1;
            next.set(id);
            id
        });
        let allocated = AirDropDelegate::alloc(mtm).set_ivars(DelegateIvars { session_id: id });
        let delegate: Retained<AirDropDelegate> = unsafe { msg_send![super(allocated), init] };
        service.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        service.setRecipients(None);
        SESSIONS.with(|sessions| {
            sessions.borrow_mut().insert(
                id,
                SharingSession {
                    service: service.clone(),
                    delegate,
                    _items: items.clone(),
                    window: source_window,
                },
            );
        });
        tracing::info!(session_id = id, service = service_key(&service), item_count = paths.len(), "Opening AirDrop chooser");
        // Only present the system recipient UI. The user chooses whether to send.
        unsafe { service.performWithItems(&items) };
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_selection_is_the_finder_entry_point() {
        assert!(validate_paths(vec![]).unwrap().is_empty());
    }

    #[test]
    fn accepts_existing_files_and_directories_without_changing_paths() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("A file with spaces.txt");
        std::fs::write(&file, "AirDrop validation only").unwrap();
        let paths = vec![
            file.to_string_lossy().into_owned(),
            directory.path().to_string_lossy().into_owned(),
        ];
        let mut duplicated = paths.clone();
        duplicated.push(paths[0].clone());
        assert_eq!(validate_paths(duplicated).unwrap(), paths);
    }

    #[test]
    fn rejects_virtual_relative_and_missing_paths_instead_of_silently_omitting_them() {
        for path in [
            "wisp://home",
            "https://example.com/file",
            "relative.txt",
            "/tmp/file\0name",
        ] {
            assert_eq!(
                validate_paths(vec![path.into()]).unwrap_err().code,
                "invalid_paths"
            );
        }
        let directory = tempfile::tempdir().unwrap();
        let missing = directory
            .path()
            .join("missing.txt")
            .to_string_lossy()
            .into_owned();
        assert_eq!(
            validate_paths(vec![missing]).unwrap_err().code,
            "invalid_paths"
        );
    }
}
