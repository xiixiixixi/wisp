use super::*;

#[test]
fn uses_first_existing_directory_and_retains_real_file_paths() {
    let root = tempfile::tempdir().unwrap();
    let one = root.path().join("one");
    let two = root.path().join("two");
    std::fs::create_dir_all(&one).unwrap();
    std::fs::create_dir_all(&two).unwrap();
    let first = one.join("first.txt");
    let second = one.join("second.txt");
    let folder = one.join("folder");
    let elsewhere = two.join("third.txt");
    for path in [&first, &second, &elsewhere] {
        std::fs::write(path, "test").unwrap();
    }
    std::fs::create_dir(&folder).unwrap();
    let missing = root.path().join("missing.txt");
    let navigation = navigation_message(&json!({"target":"reveal", "paths":[
        missing, first, elsewhere, second, folder, first, "relative/path", "https://example.com/file"
    ]})).unwrap().unwrap();
    assert_eq!(
        serde_json::to_value(&navigation).unwrap(),
        json!({
            "target":"reveal", "directory":one, "paths":[first, second, folder], "omittedCount":4
        })
    );
}

#[test]
fn rejects_missing_unbounded_or_nonfilesystem_paths() {
    for paths in [
        json!([]),
        json!([
            "https://example.com/a",
            "file:///tmp/a",
            "wisp://home",
            "relative/path",
            "/"
        ]),
        json!(["/tmp/../etc/passwd", "/tmp/nul\0file", 42]),
        json!(vec!["/tmp/one"; 257]),
        json!([format!("/{}", "x".repeat(4096))]),
        json!(vec![format!("/{}", "x".repeat(4095)); 65]),
    ] {
        assert!(navigation_message(&json!({"target":"reveal", "paths":paths})).is_err());
    }
    assert!(navigation_message(&json!({"target":"reveal"})).is_err());
    assert_eq!(
        navigation_message(&json!({"target":"unknown"})).unwrap(),
        None
    );
}

#[cfg(unix)]
#[test]
fn preserves_symbolic_link_source_and_literal_url_characters() {
    let root = tempfile::tempdir().unwrap();
    let destination = root.path().join("destination");
    let source = root.path().join("source");
    std::fs::create_dir(&destination).unwrap();
    std::fs::create_dir(&source).unwrap();
    let target = destination.join("original.txt");
    std::fs::write(&target, "test").unwrap();
    let link = source.join("a%20b?#.txt");
    std::os::unix::fs::symlink(&target, &link).unwrap();
    let result = reveal_navigation(&json!({"paths":[link]})).unwrap();
    assert_eq!(result.directory, source.to_str().unwrap());
    assert_eq!(result.paths, vec![link.to_str().unwrap()]);
}

#[test]
fn waits_for_ready_and_keeps_legacy_page_payloads() {
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("file.txt");
    std::fs::write(&file, "test").unwrap();
    let reveal = navigation_message(&json!({"target":"reveal", "paths":[file]}))
        .unwrap()
        .unwrap();
    let mut state = NavigationState::default();
    assert_eq!(
        state.navigate(ShelfNavigation::Page("settings".into())),
        None
    );
    assert_eq!(state.navigate(reveal.clone()), None);
    assert_eq!(state.ready(), Some(reveal.clone()));
    assert_eq!(state.ready(), None);
    state.loading();
    assert_eq!(state.navigate(reveal), None);
    assert_eq!(
        state.navigate(ShelfNavigation::Page("shelves".into())),
        None
    );
    assert_eq!(
        serde_json::to_value(state.ready().unwrap()).unwrap(),
        json!("shelves")
    );
    assert_eq!(
        serde_json::to_value(ShelfNavigation::Page("settings".into())).unwrap(),
        json!("settings")
    );
}
