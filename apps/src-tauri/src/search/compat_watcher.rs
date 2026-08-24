// Wisp Search Engine — Watcher & Directory Walking
//
// File-system watcher setup, directory walking, full rebuild,
// and incremental update logic for the SearchEngine.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use rayon::prelude::*;
use tracing::{info, warn};

use super::compat_engine::SearchEngine;
use super::compat_persistence::{
    content_source_for, file_meta, is_text_indexable, read_file_content,
};
use super::compat_types::TokenizerSettings;
use super::index::SearchIndex;
use super::watcher::{FileChangeEvent, FileWatcher};


// ===== Shared walk collector =================================================

/// Entry kinds discovered while walking whitelisted paths.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum WalkEntryKind {
    Directory,
    /// File whose contents can be read and full-text indexed.
    TextFile,
    /// File that only gets its name indexed (binary, oversized, …).
    NameOnlyFile,
}

/// Entries collected from one walk of the whitelisted paths.
pub(crate) struct WalkEntries {
    pub directories: Vec<PathBuf>,
    pub text_files: Vec<PathBuf>,
    pub name_only_files: Vec<PathBuf>,
}

fn is_blacklisted_path(path: &Path, blacklisted_paths: &[String]) -> bool {
    let normalized = path.to_string_lossy().replace('\\', "/").to_lowercase();
    blacklisted_paths
        .iter()
        .any(|bp| normalized.starts_with(&bp.replace('\\', "/").to_lowercase()))
}

/// Walk the whitelisted paths and classify every visible entry.
///
/// Directories are always collected by name so folder search works; files
/// whose extension is blacklisted are skipped entirely, and remaining files
/// are split into content-indexable vs name-only.
/// System locations that are never worth indexing when they sit inside a
/// whitelisted root (mirrors Spotlight's defaults). They are chatty,
/// enormous, and full of caches/logs that drown out real user files.
/// Explicitly whitelisting one of them still indexes it.
fn is_noise_path(path: &Path, whitelisted: &[String]) -> bool {
    let normalize = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_lowercase();
    let lower = normalize(&path.to_string_lossy());

    let home = std::env::var("HOME").map(|h| normalize(&h)).unwrap_or_default();
    let mut prefixes = vec!["/library".to_string()];
    if !home.is_empty() {
        prefixes.push(format!("{}/library", home));
        prefixes.push(format!("{}/.trash", home));
    }

    for prefix in prefixes {
        let in_noise = lower == prefix || lower.starts_with(&format!("{}/", prefix));
        if !in_noise {
            continue;
        }
        // Explicit opt-in: a whitelist entry inside the noise area
        // (e.g. "~/Library/Mail") still gets indexed together with its subtree.
        let opted_in = whitelisted.iter().any(|w| {
            let w = normalize(w);
            (w == prefix || w.starts_with(&format!("{}/", prefix)))
                && (lower == w || lower.starts_with(&format!("{}/", w)))
        });
        if !opted_in {
            return true;
        }
    }
    false
}

/// Plain recursive directory walk. jwalk's parallel producer/consumer was
/// observed spinning forever (workers starved, iterator hot-yielding) when
/// launched through LaunchServices, so collection uses this deterministic
/// sequential walker instead.
pub(crate) fn walk_dir_recursive(
    dir: &Path,
    max_depth: usize,
    blacklisted_exts: &HashSet<String>,
    max_file_size: u64,
    out_dirs: &mut Vec<PathBuf>,
    out_text_files: &mut Vec<PathBuf>,
    out_name_only: &mut Vec<PathBuf>,
) {
    if max_depth == 0 {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.'))
            .unwrap_or(false)
        {
            continue;
        }
        let is_dir = match entry.file_type() {
            Ok(t) => t.is_dir(),
            Err(_) => path.is_dir(),
        };
        if is_dir {
            out_dirs.push(path.clone());
            walk_dir_recursive(
                &path,
                max_depth - 1,
                blacklisted_exts,
                max_file_size,
                out_dirs,
                out_text_files,
                out_name_only,
            );
        } else if is_text_indexable(&path, blacklisted_exts, max_file_size) {
            out_text_files.push(path);
        } else {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
                .unwrap_or_default();
            if !blacklisted_exts.contains(&ext) {
                out_name_only.push(path);
            }
        }
    }
}

pub(crate) fn collect_walk_entries(settings: &TokenizerSettings) -> WalkEntries {
    let blacklisted: HashSet<String> = settings
        .blacklisted_extensions
        .iter()
        .map(|e| e.to_lowercase())
        .collect();

    let mut out = WalkEntries {
        directories: Vec::new(),
        text_files: Vec::new(),
        name_only_files: Vec::new(),
    };

    for root in &settings.whitelisted_paths {
        let root_path = Path::new(root);
        if !root_path.exists() {
            warn!("[SearchEngine] Whitelisted path does not exist: {}", root);
            continue;
        }

        // Walk the root's children (the root itself is not an entry).
        let entries = match std::fs::read_dir(root_path) {
            Ok(e) => e,
            Err(err) => {
                warn!(
                    "[SearchEngine] Cannot read whitelisted path {}: {}",
                    root,
                    err
                );
                continue;
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with('.'))
                .unwrap_or(false)
            {
                continue;
            }
            if !settings.blacklisted_paths.is_empty()
                && is_blacklisted_path(path.as_path(), &settings.blacklisted_paths)
            {
                continue;
            }
            if is_noise_path(path.as_path(), &settings.whitelisted_paths) {
                continue;
            }

            let is_dir = match entry.file_type() {
                Ok(t) => t.is_dir(),
                Err(_) => path.is_dir(),
            };
            if is_dir {
                out.directories.push(path.clone());
                walk_dir_recursive(
                    &path,
                    usize::MAX,
                    &blacklisted,
                    settings.max_file_size,
                    &mut out.directories,
                    &mut out.text_files,
                    &mut out.name_only_files,
                );
            } else if is_text_indexable(path.as_path(), &blacklisted, settings.max_file_size) {
                out.text_files.push(path);
            } else {
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_lowercase())
                    .unwrap_or_default();
                if !blacklisted.contains(&ext) {
                    // Not readable as text but not blacklisted either — keep
                    // the name searchable.
                    out.name_only_files.push(path);
                }
            }
        }
    }

    out
}

/// Classify a single path the same way `collect_walk_entries` would.
/// Returns `None` for files with a blacklisted extension (never indexed).
fn classify_path(path: &Path, settings: &TokenizerSettings) -> Option<WalkEntryKind> {
    if path.is_dir() {
        return Some(WalkEntryKind::Directory);
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    let blacklisted: HashSet<String> = settings
        .blacklisted_extensions
        .iter()
        .map(|e| e.to_lowercase())
        .collect();
    if blacklisted.contains(&ext) {
        return None;
    }
    if is_text_indexable(path, &blacklisted, settings.max_file_size) {
        Some(WalkEntryKind::TextFile)
    } else {
        Some(WalkEntryKind::NameOnlyFile)
    }
}

/// Index an entry by name only (directories and non-text files).
fn index_name_only(idx: &mut SearchIndex, path: &Path, source: &str) {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();
    let (size, modified) = file_meta(path);
    let path_str = path.to_string_lossy().to_string();
    idx.index_document(&path_str, &name, source, size, modified);
}

impl SearchEngine {
    /// Internal: walk whitelisted paths, read files, populate the index from scratch.
    pub(crate) fn rebuild_full_index_inner(
        index: &Arc<RwLock<SearchIndex>>,
        settings_arc: &Arc<Mutex<TokenizerSettings>>,
    ) {
        let settings = settings_arc
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();

        // Collect directories, text files, and name-only files.
        let entries = collect_walk_entries(&settings);
        let files_to_index = entries.text_files;

        info!(
            "[SearchEngine] Found {} text files, {} name-only files, {} directories to index",
            files_to_index.len(),
            entries.name_only_files.len(),
            entries.directories.len()
        );

        // Clear the index before a full rebuild.
        {
            let mut idx = match index.write() {
                Ok(g) => g,
                Err(e) => e.into_inner(),
            };
            *idx = SearchIndex::new();

            // Phase 0: index directories and file names first. These entries
            // are tiny (name only), so folder and file-name search works even
            // when the content phase later exhausts its memory budget.
            for dir in &entries.directories {
                index_name_only(&mut idx, dir, "directory");
            }
            for file in &entries.name_only_files {
                index_name_only(&mut idx, file, "filename_only");
            }
        }

        let memory_limit_bytes = (settings.memory_limit_mb as usize) * 1024 * 1024;

        // Index in batches to avoid loading all file contents into RAM at once.
        // Each batch reads up to BATCH_SIZE files, indexes them, then drops.
        const BATCH_SIZE: usize = 500;
        let mut indexed_count: usize = 0;
        let mut budget_exhausted = false;

        for chunk in files_to_index.chunks(BATCH_SIZE) {
            if budget_exhausted {
                break;
            }

            // Phase 1: parallel content reading for this batch only.
            let file_contents: Vec<_> = chunk
                .par_iter()
                .filter_map(|file_path| {
                    let content = read_file_content(file_path)?;
                    let source = content_source_for(file_path);
                    let (size, modified) = file_meta(file_path);
                    let path_str = file_path.to_string_lossy().to_string();
                    Some((path_str, content, source, size, modified))
                })
                .collect();

            // Phase 2: index this batch under the write lock.
            {
                let mut idx = index.write().unwrap_or_else(|e| e.into_inner());
                for (path_str, content, source, size, modified) in &file_contents {
                    idx.index_document(path_str, content, source, *size, *modified);
                    indexed_count += 1;

                    if memory_limit_bytes > 0 && idx.estimated_memory_bytes() >= memory_limit_bytes
                    {
                        warn!(
                            "[SearchEngine] Memory limit reached ({} MB). Stopping indexing after {} files.",
                            settings.memory_limit_mb,
                            indexed_count
                        );
                        budget_exhausted = true;
                        break;
                    }
                }
            }
            // file_contents dropped here — batch memory freed
        }

        // Rebuild FST and update BM25F corpus stats.
        {
            let mut idx = match index.write() {
                Ok(g) => g,
                Err(e) => e.into_inner(),
            };
            idx.rebuild_fst();
            idx.update_scorer_stats();
        }

        info!(
            "[SearchEngine] Indexed {} / {} files",
            indexed_count,
            files_to_index.len()
        );
    }

    /// Incremental update: compare cached index against filesystem.
    ///
    /// 1. Walk whitelisted paths to find all current indexable files.
    /// 2. Remove stale docs (deleted files or files with changed timestamps).
    /// 3. Index only new or modified files.
    /// 4. Rebuild FST + scorer stats.
    #[allow(dead_code)] // Retained for a future explicit "refresh index" action.
    pub(crate) fn incremental_update_inner(
        index: &Arc<RwLock<SearchIndex>>,
        settings_arc: &Arc<Mutex<TokenizerSettings>>,
    ) {
        let settings = settings_arc
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();

        // Collect every visible entry (directories and name-only files
        // included) with its kind and mtime.
        let entries = collect_walk_entries(&settings);
        let mut current_files: HashMap<String, u64> = HashMap::new(); // path -> modified
        let mut kinds: HashMap<String, WalkEntryKind> = HashMap::new();

        for dir in &entries.directories {
            let (_, modified) = file_meta(dir);
            let key = dir.to_string_lossy().to_string();
            kinds.insert(key.clone(), WalkEntryKind::Directory);
            current_files.insert(key, modified);
        }
        for file in &entries.name_only_files {
            let (_, modified) = file_meta(file);
            let key = file.to_string_lossy().to_string();
            kinds.insert(key.clone(), WalkEntryKind::NameOnlyFile);
            current_files.insert(key, modified);
        }
        for file in &entries.text_files {
            let (_, modified) = file_meta(file);
            let key = file.to_string_lossy().to_string();
            kinds.insert(key.clone(), WalkEntryKind::TextFile);
            current_files.insert(key, modified);
        }

        // Find stale documents (deleted or modified) and new files.
        let mut stale_paths: Vec<String> = Vec::new();
        let mut new_or_modified: Vec<String> = Vec::new();

        {
            let idx = match index.read() {
                Ok(g) => g,
                Err(e) => e.into_inner(),
            };

            // Check cached docs against filesystem.
            for doc in idx.documents().values() {
                match current_files.get(&doc.path) {
                    None => {
                        // File no longer exists or no longer in whitelisted paths.
                        stale_paths.push(doc.path.clone());
                    }
                    Some(&fs_modified) => {
                        if fs_modified != doc.modified {
                            // File was modified since last index.
                            stale_paths.push(doc.path.clone());
                            new_or_modified.push(doc.path.clone());
                        }
                    }
                }
            }

            // Find files not yet in the index.
            for path in current_files.keys() {
                if idx.get_document(path).is_none() {
                    new_or_modified.push(path.clone());
                }
            }
        }

        info!(
            "[SearchEngine] Incremental update: {} stale, {} new/modified (out of {} cached docs, {} current files)",
            stale_paths.len(),
            new_or_modified.len(),
            {
                let idx = match index.read() { Ok(g) => g, Err(e) => e.into_inner() };
                idx.documents().len()
            },
            current_files.len()
        );

        if stale_paths.is_empty() && new_or_modified.is_empty() {
            info!("[SearchEngine] Cache is up to date, no changes needed");
            return;
        }

        // Remove stale documents.
        if !stale_paths.is_empty() {
            let mut idx = match index.write() {
                Ok(g) => g,
                Err(e) => e.into_inner(),
            };
            for path in &stale_paths {
                idx.remove_document(path);
            }
        }

        // Index new/modified entries.
        let memory_limit_bytes = (settings.memory_limit_mb as usize) * 1024 * 1024;

        // Directories and name-only files are cheap — index them regardless
        // of the content memory budget.
        {
            let mut idx = match index.write() {
                Ok(g) => g,
                Err(e) => e.into_inner(),
            };
            for path_str in &new_or_modified {
                match kinds.get(path_str) {
                    Some(WalkEntryKind::Directory) => {
                        index_name_only(&mut idx, Path::new(path_str), "directory");
                    }
                    Some(WalkEntryKind::NameOnlyFile) => {
                        index_name_only(&mut idx, Path::new(path_str), "filename_only");
                    }
                    _ => {}
                }
            }
        }

        let text_paths: Vec<_> = new_or_modified
            .iter()
            .filter(|p| kinds.get(*p) == Some(&WalkEntryKind::TextFile))
            .cloned()
            .collect();

        // Index in batches to limit peak memory usage.
        let new_or_mod_vec: Vec<_> = text_paths;
        let mut indexed_count: usize = 0;
        let mut budget_exhausted = false;

        for chunk in new_or_mod_vec.chunks(500) {
            if budget_exhausted {
                break;
            }

            let file_contents: Vec<_> = chunk
                .par_iter()
                .filter_map(|path_str| {
                    let file_path = Path::new(path_str);
                    let content = read_file_content(file_path)?;
                    let source = content_source_for(file_path);
                    let (size, modified) = file_meta(file_path);
                    Some((path_str.clone(), content, source, size, modified))
                })
                .collect();

            {
                let mut idx = index.write().unwrap_or_else(|e| e.into_inner());
                for (path_str, content, source, size, modified) in &file_contents {
                    idx.index_document(path_str, content, source, *size, *modified);
                    indexed_count += 1;

                    if memory_limit_bytes > 0 && idx.estimated_memory_bytes() >= memory_limit_bytes
                    {
                        warn!(
                            "[SearchEngine] Memory limit reached during incremental update after {} files.",
                            indexed_count
                        );
                        budget_exhausted = true;
                        break;
                    }
                }
            }
        }

        // Rebuild FST and scorer stats.
        {
            let mut idx = match index.write() {
                Ok(g) => g,
                Err(e) => e.into_inner(),
            };
            idx.rebuild_fst();
            idx.update_scorer_stats();
        }

        info!(
            "[SearchEngine] Incremental update complete: removed {}, indexed {}",
            stale_paths.len(),
            indexed_count
        );
    }

    /// Internal directory indexing logic (runs on background thread).
    pub(crate) fn index_directory_inner(
        index: &Arc<RwLock<SearchIndex>>,
        settings_arc: &Arc<Mutex<TokenizerSettings>>,
        path_str: &str,
        depth: u32,
    ) {
        let settings = settings_arc
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();

        let blacklisted: HashSet<String> = settings
            .blacklisted_extensions
            .iter()
            .map(|e| e.to_lowercase())
            .collect();

        let root = Path::new(path_str);
        if !root.exists() || !root.is_dir() {
            return;
        }

        // Check if this path is blacklisted.
        let norm_path = path_str.replace('\\', "/").to_lowercase();
        for bp in &settings.blacklisted_paths {
            let norm_bp = bp.replace('\\', "/").to_lowercase();
            if norm_path.starts_with(&norm_bp) {
                return;
            }
        }

        let mut files_to_index: Vec<PathBuf> = Vec::new();
        let mut dirs_to_index: Vec<PathBuf> = Vec::new();

        walk_dir_recursive(
            root,
            depth as usize + 1,
            &blacklisted,
            settings.max_file_size,
            &mut dirs_to_index,
            &mut files_to_index,
            &mut Vec::new(),
        );

        if files_to_index.is_empty() && dirs_to_index.is_empty() {
            return;
        }

        info!(
            "[SearchEngine] Auto-indexing {} files + {} folders from {}",
            files_to_index.len(),
            dirs_to_index.len(),
            path_str
        );

        // -- PHASE 1: Index filenames only (fast) --
        let mut name_indexed: usize = 0;
        let mut files_needing_content: Vec<PathBuf> = Vec::new();

        // Index directories by name.
        for dir_path in &dirs_to_index {
            let ps = dir_path.to_string_lossy().to_string();
            {
                let idx = match index.read() {
                    Ok(g) => g,
                    Err(e) => e.into_inner(),
                };
                if idx.get_document(&ps).is_some() {
                    continue;
                }
            }
            let dir_name = dir_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            let (size, modified) = file_meta(dir_path);
            {
                let mut idx = match index.write() {
                    Ok(g) => g,
                    Err(e) => e.into_inner(),
                };
                idx.index_document(&ps, dir_name, "directory", size, modified);
            }
            name_indexed += 1;
        }

        // Index files by filename first (no content read yet).
        for file_path in &files_to_index {
            let ps = file_path.to_string_lossy().to_string();
            {
                let idx = match index.read() {
                    Ok(g) => g,
                    Err(e) => e.into_inner(),
                };
                if idx.get_document(&ps).is_some() {
                    continue;
                }
            }
            let file_name = file_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            let (size, modified) = file_meta(file_path);
            {
                let mut idx = match index.write() {
                    Ok(g) => g,
                    Err(e) => e.into_inner(),
                };
                idx.index_document(&ps, file_name, "filename_only", size, modified);
            }
            name_indexed += 1;
            files_needing_content.push(file_path.clone());
        }

        // Rebuild FST immediately so name-based search works right away.
        if name_indexed > 0 {
            let mut idx = match index.write() {
                Ok(g) => g,
                Err(e) => e.into_inner(),
            };
            idx.rebuild_fst();
            idx.update_scorer_stats();
            info!(
                "[SearchEngine] Phase 1: indexed {} names from {}",
                name_indexed, path_str
            );
        }

        // -- PHASE 2: Read file content and re-index (slow) --
        let memory_limit_bytes = (settings.memory_limit_mb as usize) * 1024 * 1024;
        let mut content_indexed: usize = 0;
        for file_path in &files_needing_content {
            let content = match read_file_content(file_path) {
                Some(c) => c,
                None => continue,
            };

            let source = content_source_for(file_path);
            let (size, modified) = file_meta(file_path);
            let ps = file_path.to_string_lossy().to_string();

            {
                let mut idx = match index.write() {
                    Ok(g) => g,
                    Err(e) => e.into_inner(),
                };
                idx.index_document(&ps, &content, source, size, modified);

                if memory_limit_bytes > 0 && idx.estimated_memory_bytes() >= memory_limit_bytes {
                    warn!(
                        "[SearchEngine] Memory limit reached ({} MB) during incremental indexing.",
                        settings.memory_limit_mb
                    );
                    content_indexed += 1;
                    break;
                }
            }
            content_indexed += 1;
        }

        if content_indexed > 0 {
            let mut idx = match index.write() {
                Ok(g) => g,
                Err(e) => e.into_inner(),
            };
            idx.rebuild_fst();
            idx.update_scorer_stats();
            info!(
                "[SearchEngine] Phase 2: indexed content for {} files from {}",
                content_indexed, path_str
            );
        }
    }

    /// Start the filesystem watcher on all whitelisted paths.
    pub(crate) fn start_watcher_inner(
        index: &Arc<RwLock<SearchIndex>>,
        settings_arc: &Arc<Mutex<TokenizerSettings>>,
        watcher_arc: &Arc<Mutex<FileWatcher>>,
    ) {
        let settings = settings_arc
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();

        let blacklisted: Vec<String> = settings
            .blacklisted_extensions
            .iter()
            .map(|e| e.to_lowercase())
            .collect();

        let mut watcher = watcher_arc.lock().unwrap_or_else(|e| e.into_inner());

        watcher.set_blacklisted_extensions(blacklisted.clone());

        let index_for_cb = Arc::clone(index);
        let settings_for_cb = settings.clone();

        // Debounced disk persistence: every watcher batch marks the index
        // dirty; a saver thread writes it out after 30s of quiet so
        // incremental updates survive restarts.
        let (dirty_tx, dirty_rx) = std::sync::mpsc::channel::<()>();
        let index_for_saver = Arc::clone(index);
        std::thread::Builder::new()
            .name("search-index-saver".into())
            .spawn(move || loop {
                if dirty_rx.recv().is_err() {
                    return;
                }
                loop {
                    match dirty_rx.recv_timeout(std::time::Duration::from_secs(30)) {
                        Ok(_) => continue,
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => break,
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                    }
                }
                {
                    let mut idx = match index_for_saver.write() {
                        Ok(g) => g,
                        Err(e) => e.into_inner(),
                    };
                    idx.rebuild_fst();
                    idx.update_scorer_stats();
                    idx.save_to_disk();
                }
                info!("[SearchEngine] Incremental changes saved to disk");
            })
            .ok();

        watcher.set_callback(Box::new(move |events: Vec<FileChangeEvent>| {
            let mut changed = false;
            for event in events {
                // Ignore churn under system noise locations (~/Library, …) so
                // it neither pollutes the index nor keeps the save debounce
                // permanently awake.
                let dominant_path = match &event {
                    FileChangeEvent::Created(p)
                    | FileChangeEvent::Modified(p)
                    | FileChangeEvent::Removed(p) => p.clone(),
                    FileChangeEvent::Renamed { to, .. } => to.clone(),
                };
                if is_noise_path(&dominant_path, &settings_for_cb.whitelisted_paths) {
                    continue;
                }
                match event {
                    FileChangeEvent::Created(ref p) | FileChangeEvent::Modified(ref p) => {
                        // Renames on macOS can arrive as a bare Modified event
                        // for the OLD path, which no longer exists. Treat any
                        // missing path as a removal instead of re-indexing it.
                        if !p.exists() {
                            let mut idx = match index_for_cb.write() {
                                Ok(g) => g,
                                Err(e) => e.into_inner(),
                            };
                            idx.remove_document(&p.to_string_lossy());
                            changed = true;
                            continue;
                        }
                        match classify_path(p, &settings_for_cb) {
                            Some(WalkEntryKind::Directory) => {
                                let mut idx = match index_for_cb.write() {
                                    Ok(g) => g,
                                    Err(e) => e.into_inner(),
                                };
                                index_name_only(&mut idx, p, "directory");
                                changed = true;
                            }
                            Some(WalkEntryKind::NameOnlyFile) => {
                                let mut idx = match index_for_cb.write() {
                                    Ok(g) => g,
                                    Err(e) => e.into_inner(),
                                };
                                index_name_only(&mut idx, p, "filename_only");
                                changed = true;
                            }
                            Some(WalkEntryKind::TextFile) => {
                                let content = match read_file_content(p) {
                                    Some(c) => c,
                                    None => continue,
                                };
                                let source = content_source_for(p);
                                let (size, modified) = file_meta(p);
                                let path_str = p.to_string_lossy().to_string();

                                let mut idx = match index_for_cb.write() {
                                    Ok(g) => g,
                                    Err(e) => e.into_inner(),
                                };
                                idx.index_document(&path_str, &content, source, size, modified);
                                changed = true;
                            }
                            None => {}
                        }
                    }
                    FileChangeEvent::Removed(ref p) => {
                        let path_str = p.to_string_lossy().to_string();
                        let mut idx = match index_for_cb.write() {
                            Ok(g) => g,
                            Err(e) => e.into_inner(),
                        };
                        idx.remove_document(&path_str);
                        changed = true;
                    }
                    FileChangeEvent::Renamed { ref from, ref to } => {
                        let from_str = from.to_string_lossy().to_string();

                        {
                            let mut idx = match index_for_cb.write() {
                                Ok(g) => g,
                                Err(e) => e.into_inner(),
                            };
                            idx.remove_document(&from_str);
                        }

                        match classify_path(to, &settings_for_cb) {
                            Some(WalkEntryKind::Directory) => {
                                let mut idx = match index_for_cb.write() {
                                    Ok(g) => g,
                                    Err(e) => e.into_inner(),
                                };
                                index_name_only(&mut idx, to, "directory");
                                changed = true;
                            }
                            Some(WalkEntryKind::NameOnlyFile) => {
                                let mut idx = match index_for_cb.write() {
                                    Ok(g) => g,
                                    Err(e) => e.into_inner(),
                                };
                                index_name_only(&mut idx, to, "filename_only");
                                changed = true;
                            }
                            Some(WalkEntryKind::TextFile) => {
                                if let Some(content) = read_file_content(to) {
                                    let source = content_source_for(to);
                                    let (size, modified) = file_meta(to);
                                    let to_str = to.to_string_lossy().to_string();
                                    let mut idx = match index_for_cb.write() {
                                        Ok(g) => g,
                                        Err(e) => e.into_inner(),
                                    };
                                    idx.index_document(&to_str, &content, source, size, modified);
                                    changed = true;
                                }
                            }
                            None => {}
                        }
                    }
                }
            }

            // Mark the index dirty; the saver thread rebuilds the FST and
            // BM25F stats right before persisting (rebuilding them per event
            // batch is far too expensive on busy directories).
            if changed {
                let _ = dirty_tx.send(());
            }
        }));

        if let Err(e) = watcher.start() {
            warn!("[SearchEngine] Failed to start watcher: {}", e);
            return;
        }
        info!("[SearchEngine] watcher started");

        for root in &settings.whitelisted_paths {
            match watcher.watch_path(Path::new(root)) {
                Ok(()) => info!("[SearchEngine] watching {}", root),
                Err(e) => warn!("[SearchEngine] Failed to watch path {}: {}", root, e),
            }
        }
    }
}
