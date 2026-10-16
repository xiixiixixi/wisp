use crate::operations::types::*;
use crate::operations::validate_file_path;
use rayon::prelude::*;
use std::fs;
use std::path::Path;
use std::sync::LazyLock;
use tauri::{command, Emitter};
use tokio::sync::Semaphore;

static FILE_IO_SEMAPHORE: LazyLock<Semaphore> =
    LazyLock::new(|| Semaphore::new(num_cpus::get().max(4) * 2));

/// Event name for the early directory-entry count (#31). The frontend keeps
/// the same literal in `use-directory-entry-count.ts`.
const DIRECTORY_ENTRY_COUNT_EVENT: &str = "directory-entry-count";

/// Advisory entry count shipped while the full listing is still being built
/// (#31): emitted the moment `read_dir` returns, before the per-entry stat
/// storm and the Spotlight enrichment, so the status bar can show "N items"
/// as early as Finder's first frame. The authoritative count remains
/// `files.len()` once the listing lands.
#[derive(serde::Serialize)]
struct DirectoryEntryCount {
    path: String,
    count: usize,
}

/// Build the canonical FileEntry for a path (used by the generic listing and
/// the synthesized iCloud Drive root).
fn file_entry_for(path: &Path) -> Option<FileEntry> {
    let link_metadata = fs::symlink_metadata(path).ok()?;
    let is_symlink = link_metadata.file_type().is_symlink();
    // Keep symlinked folders navigable, while still retaining the
    // link identity for the badge. Broken links fall back to their
    // own metadata instead of disappearing from the directory.
    let metadata = if is_symlink {
        fs::metadata(path).unwrap_or(link_metadata)
    } else {
        link_metadata
    };
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();
    let is_dir = metadata.is_dir();
    let file_type = crate::file_lib::get_file_type(path, is_dir);
    let mime_type = crate::file_lib::get_mime_type(path);
    let is_readonly = metadata.permissions().readonly();
    let symlink_target = if is_symlink {
        fs::read_link(path)
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
        is_alias: !is_symlink && is_finder_alias(path),
        is_cloud_placeholder: metadata_is_cloud_placeholder(&metadata),
        // Spotlight's kMDItemDateAdded overrides the birthtime fallback in
        // read_directory; kMDItemLastUsedDate has no filesystem equivalent.
        date_added: metadata_birthtime(&metadata),
        last_opened: None,
        is_executable: metadata_is_executable(&metadata),
    })
}

/// Batch-ask Spotlight for Finder's "date added" (kMDItemDateAdded) and "last
/// opened" (kMDItemLastUsedDate) through a single `mdls` call per listing.
/// `mdls -plist` either answers for every input path in order or answers not
/// at all (a single unreadable path aborts the whole batch), so a failure
/// simply leaves the birthtime fallback / None in place. Advisory by design:
/// never fail a listing over Spotlight.
#[cfg(target_os = "macos")]
async fn enrich_with_spotlight_dates(files: &mut [FileEntry]) {
    use plist::Value;

    // Keep one mdls argument list and one plist parse bounded on huge folders.
    const SPOTLIGHT_BATCH_LIMIT: usize = 2_000;
    let count = files.len().min(SPOTLIGHT_BATCH_LIMIT);
    if count == 0 {
        return;
    }

    let mut command = tokio::process::Command::new("/usr/bin/mdls");
    command
        .kill_on_drop(true)
        .arg("-name")
        .arg("kMDItemDateAdded")
        .arg("-name")
        .arg("kMDItemLastUsedDate")
        .arg("-plist")
        .arg("-");
    for file in files.iter().take(count) {
        command.arg(&file.path);
    }

    let output = match tokio::time::timeout(std::time::Duration::from_secs(2), command.output())
        .await
    {
        Ok(Ok(output)) if output.status.success() => output,
        _ => return,
    };

    let Ok(value) = Value::from_reader(std::io::Cursor::new(output.stdout)) else {
        return;
    };
    // A single input path yields a bare dictionary; multiple yield an array
    // aligned with the input order.
    let answers: Vec<&plist::Dictionary> = match &value {
        Value::Dictionary(dict) => vec![dict],
        Value::Array(items) => items.iter().filter_map(|item| item.as_dictionary()).collect(),
        _ => return,
    };

    for (entry, answer) in files.iter_mut().take(count).zip(answers) {
        if let Some(seconds) = spotlight_epoch_seconds(answer, "kMDItemDateAdded") {
            entry.date_added = Some(seconds);
        }
        if let Some(seconds) = spotlight_epoch_seconds(answer, "kMDItemLastUsedDate") {
            entry.last_opened = Some(seconds);
        }
    }
}

/// Epoch seconds for an mdls `<date>` attribute; absent keys (Spotlight has
/// no answer) map to None.
#[cfg(target_os = "macos")]
fn spotlight_epoch_seconds(answer: &plist::Dictionary, key: &str) -> Option<u64> {
    let date = answer.get(key)?.as_date()?;
    Some(system_time_to_timestamp(std::time::SystemTime::from(date)))
}

/// Finder's iCloud Drive is the whole `~/Library/Mobile Documents` tree:
/// `com~apple~CloudDocs` holds the user's files, and its sibling per-app
/// containers hold each app's cloud data.
#[cfg(target_os = "macos")]
fn icloud_mobile_root() -> Option<std::path::PathBuf> {
    let root = dirs::home_dir()?.join("Library/Mobile Documents");
    root.is_dir().then_some(root)
}

/// Containers Finder keeps out of the iCloud Drive view (system sync guts).
#[cfg(target_os = "macos")]
const ICLOUD_HIDDEN_CONTAINERS: &[&str] = &[
    "com~apple~CloudDocs",
    ".Trash",
    "com~apple~mail~preferences",
    "com~apple~mail",
    "com~apple~mobilemail",
    "com~apple~TextInput",
    "com~apple~VoiceOver~Braille",
    "com~apple~shoebox",
    "com~apple~SafariShared~History",
    "com~apple~productkit~b389personalization",
    "com~apple~productkit~personalization",
    "com~apple~iBooks~cloudData",
    "com~apple~itunesu",
    "iCloud~com~apple~itunesu",
    "iCloud~com~apple~mobilesafari",
    "iCloud~com~apple~MobileSMS",
    "iCloud~com~apple~passd",
    "com~apple~iBooks~iTunesU",
    "iCloud~com~apple~iBooks~iTunesU",
    "MQSJ8S45ED~cairot",
    "iCloud~cairot",
];

/// Finder resolves container names through FileProvider metadata; without
/// that private lookup, these overrides cover the apps whose bundle ids
/// don't self-describe.
#[cfg(target_os = "macos")]
const ICLOUD_CONTAINER_NAME_OVERRIDES: &[(&str, &str)] = &[
    ("iCloud~is~workflow~my~workflows", "Shortcuts"),
    ("com~apple~TextEdit", "文本编辑"),
];

/// A container is worth showing only when something (including an iCloud
/// `.icloud` placeholder) actually lives inside — empty scaffolds are what
/// Finder hides. The walk is capped so a huge container can't stall listing.
#[cfg(target_os = "macos")]
fn container_has_content(dir: &Path) -> bool {
    let mut stack = vec![dir.to_path_buf()];
    let mut visited = 0usize;
    while let Some(current) = stack.pop() {
        visited += 1;
        if visited > 4_000 {
            return true;
        }
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            match entry.file_type() {
                Ok(file_type) if file_type.is_dir() => stack.push(entry.path()),
                Ok(_) => return true,
                Err(_) => continue,
            }
        }
    }
    false
}

/// Best-effort friendly name: drop the team-id prefix and the
/// iCloud/com/apple routing segments, keep the last meaningful segment
/// ("com~apple~Keynote" → "Keynote", "iCloud~com~microsoft~Office~Excel" →
/// "Excel").
#[cfg(target_os = "macos")]
fn icloud_container_display_name(raw: &str) -> String {
    let mut segments: Vec<&str> = raw.split('~').collect();
    if let Some(first) = segments.first() {
        if first.len() == 10
            && first.chars().all(|c| c.is_ascii_alphanumeric())
            && first.chars().any(|c| c.is_ascii_digit())
        {
            segments.remove(0);
        }
    }
    segments.retain(|segment| !matches!(*segment, "iCloud" | "com" | "apple"));
    let chosen = match segments.len() {
        0 => return raw.to_string(),
        1 => segments[0],
        // Prefer the last app-brand segment ("…Office~Excel" → "Excel",
        // "…instagram~encryptedBackups" → "Instagram") over inner-path junk.
        _ => segments
            .iter()
            .rev()
            .find(|segment| {
                segment
                    .chars()
                    .next()
                    .map(|c| c.is_ascii_uppercase())
                    .unwrap_or(false)
            })
            .unwrap_or(segments.last().unwrap()),
    };
    let mut chars = chosen.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => raw.to_string(),
    }
}

/// Synthesize the Finder-equivalent listing of the iCloud Drive root:
/// the user's CloudDocs files plus one folder per visible app container,
/// mapped straight to its `Data` directory.
#[cfg(target_os = "macos")]
fn read_icloud_root_merged(mobile: &Path) -> Result<Vec<FileEntry>, String> {
    let cloud_docs = mobile.join("com~apple~CloudDocs");
    let mut files: Vec<FileEntry> = Vec::new();

    if cloud_docs.is_dir() {
        for entry in fs::read_dir(&cloud_docs)
            .map_err(|e| format!("Failed to read directory: {}", e))?
            .flatten()
        {
            let entry_path = entry.path();
            let name = entry_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            if name.starts_with('.') {
                continue;
            }
            if let Some(mut entry) = file_entry_for(&entry_path) {
                // Drop the CloudDocs indirection from the display name only
                // when it would collide with a real sibling.
                files.push(entry);
            }
        }
    }

    let mut used_names: std::collections::HashSet<String> =
        files.iter().map(|f| f.name.to_lowercase()).collect();
    if let Ok(containers) = fs::read_dir(mobile) {
        for container in containers.flatten() {
            let raw = container.file_name().to_string_lossy().to_string();
            if raw.starts_with('.') || ICLOUD_HIDDEN_CONTAINERS.contains(&raw.as_str()) {
                continue;
            }
            // Container layouts differ: mail-style apps keep their data in
            // `Data/`, iWork-style apps expose `Documents/` directly.
            let data_dir = container.path().join("Data");
            let documents_dir = container.path().join("Documents");
            let visible_dir = if data_dir.is_dir() {
                data_dir
            } else if documents_dir.is_dir() {
                documents_dir
            } else {
                continue;
            };
            if !container_has_content(&visible_dir) {
                continue;
            }
            let Some(mut entry) = file_entry_for(&visible_dir) else {
                continue;
            };
            let mut name = ICLOUD_CONTAINER_NAME_OVERRIDES
                .iter()
                .find(|(raw_name, _)| *raw_name == raw)
                .map(|(_, friendly)| friendly.to_string())
                .unwrap_or_else(|| icloud_container_display_name(&raw));
            let mut bump = 2;
            while !used_names.insert(name.to_lowercase()) {
                name = format!("{} ({})", icloud_container_display_name(&raw), bump);
                bump += 1;
            }
            entry.name = name;
            // Finder shows these containers as "App Library" rather than a
            // plain folder; the frontend maps this marker through i18n.
            entry.file_type = "app-library".to_string();
            files.push(entry);
        }
    }

    files.sort_by_cached_key(|f| (!f.is_dir, f.name.to_lowercase()));
    Ok(files)
}

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

/// Listing core shared by the `read_directory` command and tests. The hook
/// receives the raw entry count the moment `read_dir` returns (#31), before
/// the per-entry stat storm and Spotlight enrichment run.
pub async fn read_directory_with_count_hook<F: Fn(usize) + Send + 'static>(
    path: String,
    on_raw_count: F,
) -> Result<Vec<FileEntry>, String> {
    let _permit = FILE_IO_SEMAPHORE
        .acquire()
        .await
        .map_err(|e| e.to_string())?;
    let mut files = tokio::task::spawn_blocking(move || {
        let path = Path::new(&path);

        if !path.exists() {
            return Err("Directory does not exist".to_string());
        }

        if !path.is_dir() {
            return Err("Path is not a directory".to_string());
        }

        // iCloud Drive: serve the Finder-equivalent merged view instead of
        // the raw container soup.
        #[cfg(target_os = "macos")]
        if let Some(mobile) = icloud_mobile_root() {
            if path == mobile.as_path() {
                return read_icloud_root_merged(&mobile);
            }
        }

        let raw_entries: Vec<_> = fs::read_dir(path)
            .map_err(|e| format!("Failed to read directory: {}", e))?
            .filter_map(|e| e.ok())
            .collect();

        // The synthesized iCloud root skips the hook: its displayed count is
        // computed, not read.
        on_raw_count(raw_entries.len());

        let mut files: Vec<FileEntry> = raw_entries
            .par_iter()
            .filter_map(|entry| file_entry_for(&entry.path()))
            .collect();

        // Sort: directories first, then files
        files.sort_by_cached_key(|f| (!f.is_dir, f.name.to_lowercase()));

        Ok(files)
    })
    .await
    .map_err(|e| e.to_string())??;

    // Finder's date-added / last-opened come from Spotlight metadata, which
    // is one batched advisory lookup rather than per-entry stat work.
    #[cfg(target_os = "macos")]
    enrich_with_spotlight_dates(&mut files).await;

    Ok(files)
}

#[command]
pub async fn read_directory(app: tauri::AppHandle, path: String) -> Result<Vec<FileEntry>, String> {
    // (#31) Ship the raw entry count before the stat storm inside the hook so
    // the status bar's "N items" no longer waits for the full listing.
    let count_path = path.clone();
    read_directory_with_count_hook(path, move |count| {
        let _ = app.emit(
            DIRECTORY_ENTRY_COUNT_EVENT,
            &DirectoryEntryCount {
                path: count_path.clone(),
                count,
            },
        );
    })
    .await
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{
        finder_info_has_alias_flag, read_directory_with_count_hook, spotlight_epoch_seconds,
    };
    use std::fs;
    use std::os::unix::fs::symlink;
    use tempfile::tempdir;

    /// Explicit, metadata-only diagnostic for the user's real cloud root.
    /// No content reads, downloads, cache clearing, or file writes occur.
    #[tokio::test]
    #[ignore = "set WISP_ICLOUD_PROFILE=1 to measure the real cloud root"]
    async fn profile_real_icloud_listing_without_opening_content() {
        if std::env::var("WISP_ICLOUD_PROFILE").as_deref() != Ok("1") {
            return;
        }
        let mobile = dirs::home_dir()
            .expect("home directory")
            .join("Library/Mobile Documents");
        let mut elapsed_ms = Vec::new();
        let mut files = Vec::new();
        for _ in 0..10 {
            let started = std::time::Instant::now();
            files = read_directory_with_count_hook(mobile.to_string_lossy().to_string(), |_| {})
                .await
                .expect("read cloud root metadata");
            elapsed_ms.push(started.elapsed().as_secs_f64() * 1000.0);
        }
        let mut sorted = elapsed_ms.clone();
        sorted.sort_by(f64::total_cmp);
        println!(
            "{}",
            serde_json::json!({
                "metric": "real native read_directory completion; not UI usable time",
                "iterations": 10,
                "samples_ms": elapsed_ms,
                "p50_ms": sorted[4], "p75_ms": sorted[7], "p95_ms": sorted[9],
                "entries": files.len(),
                "cloud_placeholders": files.iter().filter(|f| f.is_cloud_placeholder).count(),
                "cloud_placeholder_logical_bytes": files.iter()
                    .filter(|f| f.is_cloud_placeholder).map(|f| f.size).sum::<u64>(),
            })
        );
    }

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
    async fn directory_entry_count_ships_with_the_listing() {
        let temp = tempdir().expect("temp dir");
        for name in ["a.txt", "b.txt", "c.txt"] {
            fs::write(temp.path().join(name), "x").expect("write file");
        }

        let counts = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = counts.clone();
        let entries = read_directory_with_count_hook(
            temp.path().to_string_lossy().to_string(),
            move |count| {
                sink.lock().unwrap_or_else(|e| e.into_inner()).push(count);
            },
        )
        .await
        .expect("read directory");

        assert_eq!(entries.len(), 3);
        // (#31) The raw entry count is reported exactly once per listing.
        assert_eq!(*counts.lock().unwrap_or_else(|e| e.into_inner()), vec![3]);
    }

    #[test]
    fn spotlight_plist_dates_parse_to_epoch_seconds() {
        // Shape captured from `mdls -name kMDItemDateAdded -name
        // kMDItemLastUsedDate -plist - <file>` on macOS 27.
        let plist_xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>kMDItemDateAdded</key>
    <date>2026-10-14T15:51:10Z</date>
    <key>kMDItemLastUsedDate</key>
    <date>2026-10-14T16:02:03Z</date>
</dict>
</plist>"#;
        let value = plist::Value::from_reader(std::io::Cursor::new(plist_xml)).expect("plist");
        let dict = value.as_dictionary().expect("dictionary");
        assert_eq!(
            spotlight_epoch_seconds(dict, "kMDItemDateAdded"),
            Some(1_791_993_070)
        );
        assert_eq!(
            spotlight_epoch_seconds(dict, "kMDItemLastUsedDate"),
            Some(1_791_993_723)
        );
        // Attributes Spotlight has no answer for are simply absent.
        assert_eq!(spotlight_epoch_seconds(dict, "kMDItemSomethingElse"), None);
    }

    #[tokio::test]
    async fn directory_entries_report_exec_bits_and_date_added_fallback() {
        let temp = tempdir().expect("temp dir");
        let script = temp.path().join("deploy.sh");
        fs::write(&script, "#!/bin/sh\n").expect("write script");
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
            .expect("exec permissions");

        let plain = temp.path().join("notes.txt");
        fs::write(&plain, "hi").expect("write plain file");

        let entries = read_directory_with_count_hook(temp.path().to_string_lossy().to_string(), |_| {})
            .await
            .expect("read directory");

        let script_entry = entries
            .iter()
            .find(|entry| entry.name == "deploy.sh")
            .expect("script entry");
        assert!(script_entry.is_executable);
        // Every entry carries a date added: Spotlight's kMDItemDateAdded when
        // indexed, the filesystem birthtime otherwise (tmp dirs are not).
        assert!(script_entry.date_added.unwrap_or(0) > 0);

        let plain_entry = entries
            .iter()
            .find(|entry| entry.name == "notes.txt")
            .expect("plain entry");
        assert!(!plain_entry.is_executable);
        assert!(plain_entry.date_added.unwrap_or(0) > 0);

        // Directories never report the execute bit even though their mode
        // carries it.
        let dir_entry = entries.iter().find(|entry| entry.is_dir);
        if let Some(dir_entry) = dir_entry {
            assert!(!dir_entry.is_executable);
        }
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

        let entries = read_directory_with_count_hook(temp.path().to_string_lossy().to_string(), |_| {})
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
pub async fn get_files_in_directory(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<FileEntry>, String> {
    read_directory(app, path).await
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
