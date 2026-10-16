use std::path::Path;
use std::time::SystemTime;

use crate::operations::trash_putback;
use crate::operations::types::*;
use crate::operations::validate_file_path;
use tauri::command;
use trash;

#[command]
pub async fn move_to_trash(path: String) -> Result<(), String> {
    validate_file_path(&path)?;
    let path_obj = Path::new(&path);

    if !path_obj.exists() {
        return Err("File or directory does not exist".to_string());
    }

    trash::delete(path_obj).map_err(|e| format!("Failed to move to trash: {}", e))?;

    // Record put-back metadata so 放回原处 can restore Wisp-trashed items.
    // The trash crate performs a Finder-style move but leaves no trail.
    #[cfg(target_os = "macos")]
    trash_putback::record_putback(&path);

    Ok(())
}

#[command]
pub async fn get_trash_items() -> Result<Vec<TrashItem>, String> {
    #[cfg(windows)]
    {
        // Use the Windows-specific recycle bin implementation
        crate::windows_recycle_bin::get_recycle_bin_items()
    }

    #[cfg(target_os = "macos")]
    {
        // On macOS, trash items are in ~/.Trash. Hidden entries (Finder's
        // .DS_Store, Wisp's put-back ledger) are metadata, not trash items.
        use std::fs;
        let mut trash_items = Vec::new();

        if let Some(home_dir) = dirs::home_dir() {
            let trash_path = home_dir.join(".Trash");
            if let Ok(entries) = fs::read_dir(trash_path) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with('.') {
                        continue;
                    }
                    if let Ok(metadata) = entry.metadata() {
                        let modified = metadata
                            .modified()
                            .unwrap_or(SystemTime::UNIX_EPOCH)
                            .duration_since(SystemTime::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();

                        // Finder writes put-back info (ptbL/ptbN) into the
                        // trash's .DS_Store; Wisp keeps its own ledger for
                        // items it trashed. Without either, original_path
                        // falls back to the in-trash path and the client
                        // hides 放回原处.
                        let in_trash_path = entry.path().to_string_lossy().to_string();
                        let original_path = trash_putback::lookup_original(&entry.path())
                            .unwrap_or_else(|| in_trash_path.clone());

                        trash_items.push(TrashItem {
                            name: name.clone(),
                            original_path,
                            trash_path: Some(in_trash_path),
                            deletion_date: modified,
                            size: if metadata.is_dir() { 0 } else { metadata.len() },
                            is_dir: metadata.is_dir(),
                        });
                    }
                }
            }
        }
        Ok(trash_items)
    }

    #[cfg(target_os = "linux")]
    {
        // On Linux, trash items follow the freedesktop spec:
        // ~/.local/share/Trash/files/<name> + info/<name>.trashinfo.
        use std::fs;
        let mut trash_items = Vec::new();

        if let Some(home_dir) = dirs::home_dir() {
            let trash_root = home_dir.join(".local/share/Trash");
            if let Ok(entries) = fs::read_dir(trash_root.join("files")) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with('.') {
                        continue;
                    }
                    if let Ok(metadata) = entry.metadata() {
                        let modified = metadata
                            .modified()
                            .unwrap_or(SystemTime::UNIX_EPOCH)
                            .duration_since(SystemTime::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();

                        let in_trash_path = entry.path().to_string_lossy().to_string();
                        let info = fs::read_to_string(
                            trash_root.join("info").join(format!("{}.trashinfo", name)),
                        )
                        .ok()
                        .and_then(|text| trash_putback::parse_trashinfo(&text));
                        let (original_path, deletion_date) = match info {
                            Some((original, ts)) => (original, if ts > 0 { ts } else { modified }),
                            None => (in_trash_path.clone(), modified),
                        };

                        trash_items.push(TrashItem {
                            name: name.clone(),
                            original_path,
                            trash_path: Some(in_trash_path),
                            deletion_date,
                            size: if metadata.is_dir() { 0 } else { metadata.len() },
                            is_dir: metadata.is_dir(),
                        });
                    }
                }
            }
        }
        Ok(trash_items)
    }

    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        Err("Trash listing not supported on this platform".to_string())
    }
}

#[command]
pub async fn restore_trash_item(item_path: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        crate::windows_recycle_bin::restore_from_recycle_bin(&item_path)
    }

    #[cfg(not(windows))]
    {
        validate_file_path(&item_path)?;
        let trash_path = Path::new(&item_path);

        if !trash_path.exists() {
            return Err("File no longer exists in trash".to_string());
        }

        // 放回原处: move the item back to its original location. The source
        // is Finder's put-back metadata (.DS_Store ptbL/ptbN) or Wisp's own
        // ledger; without either, the client never offers the action.
        #[cfg(target_os = "macos")]
        let original = trash_putback::lookup_original(trash_path);
        #[cfg(target_os = "linux")]
        let original = {
            let name = trash_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            std::fs::read_to_string(
                trash_path
                    .parent()
                    .and_then(|files| files.parent())
                    .map(|root| root.join("info").join(format!("{}.trashinfo", name)))
                    .ok_or("Put-back information is unavailable")?,
            )
            .ok()
            .and_then(|text| trash_putback::parse_trashinfo(&text))
            .map(|(original, _)| original)
        };
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        let original: Option<String> = None;

        let original = original.ok_or_else(|| {
            "Put-back information is unavailable for this item".to_string()
        })?;
        let destination = Path::new(&original);
        if destination.exists() {
            return Err(format!(
                "Cannot put back: \"{}\" already exists at the original location",
                original
            ));
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to restore destination directory: {}", e))?;
        }
        std::fs::rename(trash_path, destination)
            .map_err(|e| format!("Failed to restore file: {}", e))?;

        #[cfg(target_os = "macos")]
        trash_putback::remove_ledger_entry(trash_path);

        Ok(original)
    }
}

#[command]
pub async fn empty_recycle_bin() -> Result<usize, String> {
    #[cfg(windows)]
    {
        crate::windows_recycle_bin::empty_recycle_bin()
    }

    #[cfg(not(windows))]
    {
        #[cfg(target_os = "macos")]
        let trash_entries_root = dirs::home_dir().map(|home| home.join(".Trash"));
        #[cfg(target_os = "linux")]
        let trash_entries_root = dirs::home_dir().map(|home| home.join(".local/share/Trash/files"));
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        let trash_entries_root: Option<std::path::PathBuf> = None;

        let root = trash_entries_root.ok_or("Trash folder not found")?;
        let deleted = empty_trash_root(&root);

        // Drop the put-back ledger with the items it described.
        #[cfg(target_os = "macos")]
        {
            let ledger = root.join(".wisp-putback.json");
            let _ = std::fs::write(&ledger, "{}");
        }
        #[cfg(target_os = "linux")]
        {
            if let Some(info_root) = root.parent().map(|r| r.join("info")) {
                if let Ok(infos) = std::fs::read_dir(&info_root) {
                    for info in infos.flatten() {
                        let _ = std::fs::remove_file(info.path());
                    }
                }
            }
        }

        Ok(deleted)
    }
}

/// Remove every visible entry under a trash root, keeping hidden metadata.
/// Returns how many items were deleted.
#[cfg(not(windows))]
fn empty_trash_root(root: &Path) -> usize {
    let mut deleted = 0usize;
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            // Hidden entries are metadata (.DS_Store, put-back ledger).
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let path = entry.path();
            let removed = if path.is_dir() {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_file(&path)
            };
            if removed.is_ok() {
                deleted += 1;
            }
        }
    }
    deleted
}

#[command]
pub async fn permanently_delete_trash_item(item_path: String) -> Result<(), String> {
    validate_file_path(&item_path)?;
    // Permanently delete a file from the recycle bin
    let path = std::path::Path::new(&item_path);

    if !path.exists() {
        return Err("File no longer exists".to_string());
    }

    std::fs::remove_file(path)
        .or_else(|_| std::fs::remove_dir_all(path))
        .map_err(|e| format!("Failed to permanently delete item: {}", e))?;

    #[cfg(target_os = "macos")]
    trash_putback::remove_ledger_entry(path);

    // Also try to remove corresponding $I file if this is a $R file
    if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
        if filename.starts_with("$R") {
            let i_file_name = filename.replace("$R", "$I");
            if let Some(parent) = path.parent() {
                let i_file_path = parent.join(i_file_name);
                let _ = std::fs::remove_file(i_file_path); // Ignore errors
            }
        }
    }

    Ok(())
}

#[command]
pub async fn open_recycle_bin() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("shell:RecycleBinFolder")
            .spawn()
            .map_err(|e| format!("Failed to open Recycle Bin: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("~/.Trash")
            .spawn()
            .map_err(|e| format!("Failed to open Trash: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try to open with the default file manager
        let trash_dir = std::env::var("HOME").unwrap_or_default() + "/.local/share/Trash/files";
        std::process::Command::new("xdg-open")
            .arg(trash_dir)
            .spawn()
            .map_err(|e| format!("Failed to open Trash: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn restores_wisp_trashed_item_to_original_location() {
        use std::fs;
        let temp = tempfile::tempdir().expect("tempdir");
        let unique = format!("wisp-putback-{}.txt", std::process::id());
        let original_dir = temp.path().join("source");
        fs::create_dir_all(&original_dir).expect("create source dir");
        let original = original_dir.join(&unique);
        fs::write(&original, "data").expect("write file");

        move_to_trash(original.to_string_lossy().to_string())
            .await
            .expect("trash item");
        let trash_home = dirs::home_dir().unwrap().join(".Trash");
        let landed = trash_home.join(&unique);
        assert!(landed.exists(), "item should have landed in ~/.Trash");

        let restored = restore_trash_item(landed.to_string_lossy().to_string())
            .await
            .expect("put back");
        assert_eq!(restored, original.to_string_lossy().to_string());
        assert!(original.exists(), "file should be back at the original path");
        assert!(!landed.exists(), "file should have left the trash");

        // Clean up the restored file so the test leaves no residue.
        let _ = fs::remove_file(&original);
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn restore_without_putback_metadata_fails_cleanly() {
        use std::fs;
        let unique = format!("wisp-restore-stray-{}.txt", std::process::id());
        let stray = dirs::home_dir().unwrap().join(".Trash").join(&unique);
        fs::write(&stray, "stray").expect("write stray item");

        let result = restore_trash_item(stray.to_string_lossy().to_string()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Put-back information"));

        let _ = fs::remove_file(&stray);
    }

    #[cfg(not(windows))]
    #[test]
    fn empty_trash_root_removes_entries_but_keeps_metadata() {
        use std::fs;
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path().join("trash");
        fs::create_dir_all(&root).expect("create trash root");
        fs::write(root.join("item.txt"), "x").expect("write item");
        fs::create_dir(root.join("folder")).expect("create folder");
        fs::write(root.join(".DS_Store"), [0u8; 8]).expect("write metadata");

        assert_eq!(empty_trash_root(&root), 2);
        assert!(root.join(".DS_Store").exists());
        assert!(!root.join("item.txt").exists());
        assert!(!root.join("folder").exists());
    }
}
