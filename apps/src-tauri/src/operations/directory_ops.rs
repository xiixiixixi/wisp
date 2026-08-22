use crate::operations::types::*;
use crate::operations::validate_file_path;
use rayon::prelude::*;
use std::fs;
use std::path::Path;
use std::sync::LazyLock;
use tauri::command;
use tokio::sync::Semaphore;

static FILE_IO_SEMAPHORE: LazyLock<Semaphore> =
    LazyLock::new(|| Semaphore::new(num_cpus::get().max(4) * 2));

#[cfg(target_os = "macos")]
fn finder_info_has_alias_flag(finder_info: &[u8]) -> bool {
    // FinderInfo bytes 8..10 contain the big-endian Finder flags. kIsAlias is
    // bit 0x8000. Short or missing attributes are not aliases.
    finder_info
        .get(8..10)
        .map(|bytes| u16::from_be_bytes([bytes[0], bytes[1]]) & 0x8000 != 0)
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn is_finder_alias(path: &Path) -> bool {
    xattr::get(path, "com.apple.FinderInfo")
        .ok()
        .flatten()
        .map(|finder_info| finder_info_has_alias_flag(&finder_info))
        .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
fn is_finder_alias(_path: &Path) -> bool {
    false
}

#[command]
pub async fn read_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let _permit = FILE_IO_SEMAPHORE
        .acquire()
        .await
        .map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || {
        let path = Path::new(&path);

        if !path.exists() {
            return Err("Directory does not exist".to_string());
        }

        if !path.is_dir() {
            return Err("Path is not a directory".to_string());
        }

        let raw_entries: Vec<_> = fs::read_dir(path)
            .map_err(|e| format!("Failed to read directory: {}", e))?
            .filter_map(|e| e.ok())
            .collect();

        let mut files: Vec<FileEntry> = raw_entries
            .par_iter()
            .filter_map(|entry| {
                let path = entry.path();
                let link_metadata = fs::symlink_metadata(&path).ok()?;
                let is_symlink = link_metadata.file_type().is_symlink();
                // Keep symlinked folders navigable, while still retaining the
                // link identity for the badge. Broken links fall back to their
                // own metadata instead of disappearing from the directory.
                let metadata = if is_symlink {
                    fs::metadata(&path).unwrap_or(link_metadata)
                } else {
                    link_metadata
                };
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                let is_dir = metadata.is_dir();
                let file_type = crate::file_lib::get_file_type(&path, is_dir);
                let mime_type = crate::file_lib::get_mime_type(&path);
                let is_readonly = metadata.permissions().readonly();
                let symlink_target = if is_symlink {
                    fs::read_link(&path)
                        .ok()
                        .map(|target| target.to_string_lossy().to_string())
                } else {
                    None
                };
                Some(FileEntry {
                    name,
                    path: path.to_string_lossy().to_string(),
                    is_dir,
                    size: metadata.len(),
                    modified: system_time_to_timestamp(
                        metadata
                            .modified()
                            .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
                    ),
                    file_type,
                    mime_type,
                    is_readonly,
                    is_symlink,
                    symlink_target,
                    is_alias: !is_symlink && is_finder_alias(&path),
                })
            })
            .collect();

        // Sort: directories first, then files
        files.sort_by_cached_key(|f| (!f.is_dir, f.name.to_lowercase()));

        Ok(files)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{finder_info_has_alias_flag, read_directory};
    use std::fs;
    use std::os::unix::fs::symlink;
    use tempfile::tempdir;

    #[test]
    fn detects_finder_alias_flag() {
        let mut finder_info = [0_u8; 32];
        finder_info[8] = 0x80;
        assert!(finder_info_has_alias_flag(&finder_info));
    }

    #[test]
    fn rejects_regular_or_truncated_finder_info() {
        assert!(!finder_info_has_alias_flag(&[0_u8; 32]));
        assert!(!finder_info_has_alias_flag(&[0_u8; 8]));
    }

    #[tokio::test]
    async fn directory_entries_distinguish_symlinks_and_finder_aliases() {
        let temp = tempdir().expect("temp dir");
        let original = temp.path().join("original.txt");
        let link = temp.path().join("original-link.txt");
        let alias = temp.path().join("original alias");
        fs::write(&original, "original").expect("write original");
        symlink(&original, &link).expect("create symlink");
        fs::write(&alias, "alias payload").expect("write alias placeholder");

        let mut finder_info = [0_u8; 32];
        finder_info[8] = 0x80;
        xattr::set(&alias, "com.apple.FinderInfo", &finder_info).expect("set FinderInfo");

        let entries = read_directory(temp.path().to_string_lossy().to_string())
            .await
            .expect("read directory");
        let link_entry = entries
            .iter()
            .find(|entry| entry.name == "original-link.txt")
            .expect("symlink entry");
        assert!(link_entry.is_symlink);
        assert_eq!(link_entry.symlink_target.as_deref(), original.to_str());
        assert!(!link_entry.is_alias);

        let alias_entry = entries
            .iter()
            .find(|entry| entry.name == "original alias")
            .expect("alias entry");
        assert!(alias_entry.is_alias);
        assert!(!alias_entry.is_symlink);
    }
}

#[command]
pub async fn is_dir(path: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let path = Path::new(&path);
        Ok(path.is_dir())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[command]
pub async fn get_files_in_directory(path: String) -> Result<Vec<FileEntry>, String> {
    read_directory(path).await
}

#[command]
pub async fn remove_dir(path: String) -> Result<(), String> {
    validate_file_path(&path)?;
    let path = Path::new(&path);

    if !path.exists() {
        return Err("Directory does not exist".to_string());
    }

    if !path.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    fs::remove_dir_all(path).map_err(|e| format!("Failed to remove directory: {}", e))?;

    Ok(())
}

#[command]
pub async fn create_dir_recursive(path: String) -> Result<(), String> {
    validate_file_path(&path)?;
    let path = Path::new(&path);

    fs::create_dir_all(path).map_err(|e| format!("Failed to create directory: {}", e))?;

    Ok(())
}

#[command]
pub async fn get_dir_size(path: String) -> Result<DirectorySize, String> {
    let _permit = FILE_IO_SEMAPHORE
        .acquire()
        .await
        .map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || {
        let path = Path::new(&path);

        if !path.exists() {
            return Err("Directory does not exist".to_string());
        }

        if !path.is_dir() {
            return Err("Path is not a directory".to_string());
        }

        // Use jwalk for parallel directory walking
        let mut total_size: u64 = 0;
        let mut file_count: usize = 0;
        let mut dir_count: usize = 0;

        for entry in jwalk::WalkDir::new(path)
            .skip_hidden(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_file() {
                file_count += 1;
                if let Ok(meta) = entry.metadata() {
                    total_size += meta.len();
                }
            } else if entry.file_type().is_dir() {
                // Don't count the root directory itself
                if entry.depth() > 0 {
                    dir_count += 1;
                }
            }
        }

        Ok(DirectorySize {
            total_size,
            file_count,
            dir_count,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
