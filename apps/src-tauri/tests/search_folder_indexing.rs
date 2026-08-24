//! Regression tests for folder searchability: the index must contain
//! directories, a lone type keyword ("Documents") must match the folder
//! instead of being hijacked as a file-type filter, and a directory whose
//! name matches the query must outrank content-only matches.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, Once, OnceLock};
use std::time::{Duration, Instant};

/// The engine's persistent state is process-global (env var + data dir), so
/// these tests must not run concurrently with each other.
static TEST_LOCK: Mutex<()> = Mutex::new(());

fn test_lock() -> std::sync::MutexGuard<'static, ()> {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        init_test_data_dir();
    });
    TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

use wisp::search::compat_engine::SearchEngine;
use wisp::search::compat_types::TokenizerSettings;

/// Point the engine's persistent state (index cache + settings) at a shared
/// temp directory so tests never touch the user's real data.
fn init_test_data_dir() -> PathBuf {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    let dir = DIR.get_or_init(|| {
        let d = std::env::temp_dir().join(format!("wisp-search-test-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d.clone()
    });
    // Safe to call repeatedly; both tests share one process.
    std::env::set_var("WISP_DATA_DIR", dir);
    dir.clone()
}

fn wait_until_indexed(engine: &SearchEngine) {
    let start = Instant::now();
    while engine.is_indexing() {
        assert!(start.elapsed() < Duration::from_secs(30), "indexing timed out");
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn make_engine(root: &Path) -> SearchEngine {
    let mut settings = TokenizerSettings::default();
    settings.enabled = true;
    settings.whitelisted_paths = vec![root.to_string_lossy().to_string()];
    settings.memory_limit_mb = 64;

    let engine = SearchEngine::new();
    engine.set_settings(settings);
    engine
}

#[test]
fn rebuild_indexes_directories_and_they_win_name_queries() {
    let _guard = test_lock();
    let tmp = tempfile::tempdir().expect("tempdir");
    let tmp = std::fs::canonicalize(tmp.path()).expect("canonicalize");
    let docs = tmp.join("Documents");
    std::fs::create_dir_all(&docs).unwrap();
    // A large text file that mentions "documents" many times — classic BM25F
    // bait that used to bury the folder.
    let bait = tmp.join("bait.txt");
    let content = "documents documents documents\n".repeat(500);
    std::fs::write(&bait, content).unwrap();
    std::fs::write(docs.join("notes.txt"), "meeting notes").unwrap();

    let engine = make_engine(&tmp);
    engine.rebuild_full_index();
    wait_until_indexed(&engine);

    let results = engine.search("Documents", 10);
    assert!(!results.is_empty(), "no results for Documents");
    assert_eq!(
        results[0].path,
        docs.to_string_lossy().to_string(),
        "Documents folder should rank first, got: {:?}",
        results.iter().map(|r| r.path.clone()).collect::<Vec<_>>()
    );

    let results = engine.search("notes", 10);
    assert!(results.iter().any(|r| r.path.ends_with("notes.txt")));
}

#[test]
fn watcher_events_index_new_and_renamed_folders() {
    let _guard = test_lock();
    let tmp = tempfile::tempdir().expect("tempdir");
    let tmp = std::fs::canonicalize(tmp.path()).expect("canonicalize");
    let engine = make_engine(&tmp);
    engine.rebuild_full_index();
    wait_until_indexed(&engine);

    // Rebuild the engine the way the app does so the watcher is running.
    let engine = make_engine(&tmp);
    engine.start();
    let deadline = Instant::now() + Duration::from_secs(20);
    while engine.is_indexing() {
        assert!(Instant::now() < deadline, "startup indexing timed out");
        std::thread::sleep(Duration::from_millis(50));
    }

    // Give the freshly-registered FSEvents stream a moment to arm before
    // generating activity (registration latency varies on macOS).
    std::thread::sleep(Duration::from_millis(800));

    // Create a folder and wait for the watcher to pick it up.
    let new_dir = tmp.join("brand-new-folder");
    std::fs::create_dir_all(&new_dir).unwrap();
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let found = engine
            .search("brand-new-folder", 10)
            .iter()
            .any(|r| r.path == new_dir.to_string_lossy().to_string());
        if found {
            break;
        }
        assert!(Instant::now() < deadline, "watcher never indexed new folder");
        std::thread::sleep(Duration::from_millis(200));
    }

    // Renaming must remove the old entry and index the new one.
    let renamed = tmp.join("renamed-folder");
    std::fs::rename(&new_dir, &renamed).unwrap();
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let has_new = engine
            .search("renamed-folder", 10)
            .iter()
            .any(|r| r.path == renamed.to_string_lossy().to_string());
        let has_old = engine
            .search("brand-new-folder", 10)
            .iter()
            .any(|r| r.path == new_dir.to_string_lossy().to_string());
        if has_new && !has_old {
            break;
        }
        assert!(Instant::now() < deadline, "rename not reflected in index");
        std::thread::sleep(Duration::from_millis(200));
    }
}
