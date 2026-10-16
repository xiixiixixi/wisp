//! iCloud placeholder materialization (Finder's 「立即下载」 / cmdDownloadNow).
//!
//! Finder right-clicks an SF_DATALESS placeholder and asks the file provider
//! to fetch the content. The preferred path is a coordinated read through
//! NSFileCoordinator — the same handshake Finder uses — which lets the
//! provider materialize the file before the bytes are read. When no
//! coordinator answers (non-macOS, provider unavailable, coordination error)
//! the command falls back to `brctl download`, the CLI front door for the
//! same request. Both paths share one 60-second ceiling so a stalled
//! provider can never wedge the UI promise forever.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;
use tauri::{command, Emitter};
use tokio::process::Command as TokioCommand;

use super::types::metadata_is_cloud_placeholder;

/// Emitted once a placeholder finishes materializing so every Wisp window can
/// refresh the row — the next listing reports `is_cloud_placeholder: false`.
pub const ICLOUD_FILE_DOWNLOADED_EVENT: &str = "icloud-file-downloaded";

/// Finder's practical ceiling for a stalled provider download.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct IcloudDownloadResult {
    pub materialized: bool,
    pub method: String,
}

/// Pure argument assembly so tests can pin the brctl invocation shape.
pub(crate) fn brctl_download_args(path: &str) -> Vec<String> {
    vec!["download".to_string(), path.to_string()]
}

/// Run an external download helper under the shared timeout. The child is
/// killed when the deadline passes (`kill_on_drop` covers the error paths).
async fn run_download_command(
    program: &str,
    args: &[String],
    timeout: Duration,
) -> Result<(), String> {
    let mut command = TokioCommand::new(program);
    command.args(args).kill_on_drop(true);
    let status = tokio::time::timeout(timeout, command.status())
        .await
        .map_err(|_| format!("Download timed out after {} seconds", timeout.as_secs()))?
        .map_err(|e| format!("Failed to run {}: {}", program, e))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{} exited with {:?}", program, status.code()))
    }
}

/// Coordinated single-file read: the provider materializes the dataless item
/// before the accessor runs, exactly like Finder's own download action.
#[cfg(target_os = "macos")]
fn materialize_via_file_coordinator(path: &Path) -> Result<(), String> {
    use std::ptr::NonNull;
    use std::sync::Mutex;

    use block2::RcBlock;
    use objc2::rc::autoreleasepool;

    use objc2_foundation::{
        NSFileCoordinator, NSFileCoordinatorReadingOptions, NSError, NSString, NSURL,
    };

    let path_string = path.to_string_lossy().to_string();
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path_string));
    let read_error: Mutex<Option<String>> = Mutex::new(None);
    let error_for_block = &read_error;

    // A plain coordinated read (empty options) of a dataless item makes the
    // file provider download it; reading the bytes inside the accessor forces
    // the full materialization before coordination returns.
    let reader = RcBlock::new(move |provided: NonNull<NSURL>| {
        let url: &NSURL = unsafe { provided.as_ref() };
        match url.path() {
            Some(materialized) => {
                if let Err(e) = std::fs::read(materialized.to_string()) {
                    *error_for_block.lock().unwrap_or_else(|e| e.into_inner()) =
                        Some(format!("Failed to read materialized file: {}", e));
                }
            }
            None => {
                *error_for_block.lock().unwrap_or_else(|e| e.into_inner()) =
                    Some("File coordinator URL has no path".to_string());
            }
        }
    });

    autoreleasepool(|_| {
        let coordinator = NSFileCoordinator::new();
        let mut coordination_error: Option<objc2::rc::Retained<NSError>> = None;
        coordinator.coordinateReadingItemAtURL_options_error_byAccessor(
            &url,
            NSFileCoordinatorReadingOptions::empty(),
            Some(&mut coordination_error),
            &reader,
        );
        if coordination_error.is_some() {
            return Err("File coordination failed".to_string());
        }
        Ok(())
    })?;
    // The block borrows `read_error`; release it before consuming the value.
    drop(reader);

    match read_error.into_inner().unwrap_or_else(|e| e.into_inner()) {
        Some(message) => Err(message),
        None => Ok(()),
    }
}

/// Coordinated read is the FileProvider path and only exists on macOS.
#[cfg(not(target_os = "macos"))]
fn materialize_via_file_coordinator(_path: &Path) -> Result<(), String> {
    Err("File coordination unavailable on this platform".to_string())
}

/// Listing-free core shared with tests: validate, verify the placeholder
/// state, then walk the coordinator → brctl fallback chain.
async fn download_icloud_file_core(path: &str) -> Result<IcloudDownloadResult, String> {
    super::validate_file_path(path)?;

    let stat_path = path.to_string();
    let is_placeholder = tokio::task::spawn_blocking(move || {
        std::fs::metadata(&stat_path).map(|metadata| metadata_is_cloud_placeholder(&metadata))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Cannot access file: {}", e))?;

    // The download may have completed (watcher, another app) between the
    // listing and this click — report it instead of failing.
    if !is_placeholder {
        return Ok(IcloudDownloadResult {
            materialized: false,
            method: "already-local".to_string(),
        });
    }

    let coordinator_path = path.to_string();
    let coordinated = tokio::task::spawn_blocking(move || {
        materialize_via_file_coordinator(Path::new(&coordinator_path))
    })
    .await
    .map_err(|e| e.to_string())?;

    if coordinated.is_ok() {
        return Ok(IcloudDownloadResult {
            materialized: true,
            method: "file-coordinator".to_string(),
        });
    }
    // Coordinator could not answer — fall through to brctl.

    let args = brctl_download_args(path);
    run_download_command("/usr/bin/brctl", &args, DOWNLOAD_TIMEOUT).await?;
    Ok(IcloudDownloadResult {
        materialized: true,
        method: "brctl".to_string(),
    })
}

#[command]
pub async fn download_icloud_file(
    app: tauri::AppHandle,
    path: String,
) -> Result<IcloudDownloadResult, String> {
    let result = download_icloud_file_core(&path).await?;
    if result.materialized {
        let _ = app.emit(
            ICLOUD_FILE_DOWNLOADED_EVENT,
            serde_json::json!({ "path": path, "materialized": true }),
        );
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brctl_args_are_download_then_path() {
        assert_eq!(
            brctl_download_args("/Users/tc/Library/Mobile Documents/a~b.txt"),
            vec!["download", "/Users/tc/Library/Mobile Documents/a~b.txt"]
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn download_command_enforces_the_deadline() {
        // `sleep` stands in for a stalled provider; the wrapper must give up
        // at the timeout instead of waiting for the child.
        let started = std::time::Instant::now();
        let args = vec!["30".to_string()];
        let outcome = run_download_command("/bin/sleep", &args, Duration::from_secs(1)).await;
        assert!(outcome.is_err());
        assert!(outcome.unwrap_err().contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn download_command_passes_through_exit_status() {
        let outcome = run_download_command("/usr/bin/true", &[], Duration::from_secs(10)).await;
        assert!(outcome.is_ok());
        let outcome = run_download_command("/usr/bin/false", &[], Duration::from_secs(10)).await;
        assert!(outcome.is_err());
    }

    #[tokio::test]
    async fn missing_file_reports_an_access_error() {
        let outcome = download_icloud_file_core("/nonexistent/wisp-placeholder-test").await;
        assert!(outcome.is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn local_file_short_circuits_without_touching_brctl() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("resident.txt");
        std::fs::write(&file, "local bytes").unwrap();
        let outcome = download_icloud_file_core(file.to_str().unwrap()).await.unwrap();
        assert!(!outcome.materialized);
        assert_eq!(outcome.method, "already-local");
    }
}
