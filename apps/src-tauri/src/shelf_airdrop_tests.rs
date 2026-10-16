use super::*;

#[test]
fn accepts_real_files_and_folders_and_deduplicates_without_changing_source_paths() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("a%20b?#.txt");
    std::fs::write(&file, "validation only").unwrap();
    let folder = directory.path().join("folder");
    std::fs::create_dir(&folder).unwrap();
    let result = airdrop_paths(&json!({"event":"airdrop", "paths":[file, folder, file]})).unwrap();
    assert_eq!(
        result,
        vec![file.to_str().unwrap(), folder.to_str().unwrap()]
    );
}

#[test]
fn rejects_empty_or_malformed_batches_without_an_empty_service_selection() {
    for message in [
        Value::Null,
        json!({}),
        json!({"paths":null}),
        json!({"paths":"/tmp/file"}),
        json!({"paths":[]}),
        json!({"paths":[42]}),
        json!({"paths":[[]]}),
    ] {
        assert_eq!(airdrop_paths(&message).unwrap_err().code, "invalid_paths");
    }
}

#[test]
fn rejects_the_entire_batch_when_any_path_is_missing_relative_or_a_url() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("valid.txt");
    std::fs::write(&file, "validation only").unwrap();
    let missing = directory
        .path()
        .join("missing.txt")
        .to_string_lossy()
        .into_owned();
    for bad in [
        missing,
        "relative/file.txt".into(),
        "file:///tmp/file.txt".into(),
        "https://example.com/file.txt".into(),
        "wisp://home".into(),
        "/tmp/nul\0file".into(),
        format!("{}/../valid.txt", directory.path().display()),
    ] {
        assert_eq!(
            airdrop_paths(&json!({"paths":[file,bad]}))
                .unwrap_err()
                .code,
            "invalid_paths"
        );
    }
    assert!(airdrop_paths(&json!({"paths":[file,false]})).is_err());
}

#[test]
fn enforces_count_per_path_and_total_byte_limits_before_launch() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("file.txt");
    std::fs::write(&file, "validation only").unwrap();
    let raw = file.to_str().unwrap();
    assert_eq!(
        airdrop_paths(&json!({"paths":vec![raw;256]})).unwrap(),
        vec![raw]
    );
    assert!(airdrop_paths(&json!({"paths":vec![raw;257]})).is_err());
    let too_long = format!("/{}", "x".repeat(4096));
    assert!(airdrop_paths(&json!({"paths":[too_long]})).is_err());
    let padded = format!(
        "{}/{}file.txt",
        directory.path().display(),
        "./".repeat(1500)
    );
    assert!(padded.len() <= 4096);
    assert_eq!(
        airdrop_paths(&json!({"paths":[padded]})).unwrap(),
        vec![raw]
    );
    let count = 64 * 1024 / padded.len() + 1;
    assert!(count <= 256);
    assert!(airdrop_paths(&json!({"paths":vec![padded;count]})).is_err());
}

#[cfg(unix)]
#[test]
fn retains_symbolic_link_source_location_and_rejects_special_files() {
    let directory = tempfile::tempdir().unwrap();
    let target = directory.path().join("target.txt");
    std::fs::write(&target, "validation only").unwrap();
    let source = directory.path().join("source.txt");
    std::os::unix::fs::symlink(&target, &source).unwrap();
    assert_eq!(
        airdrop_paths(&json!({"paths":[source]})).unwrap(),
        vec![source.to_str().unwrap()]
    );
    let socket = directory.path().join("socket");
    let _listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
    assert_eq!(
        airdrop_paths(&json!({"paths":[target,socket]}))
            .unwrap_err()
            .code,
        "invalid_paths"
    );
}

#[cfg(unix)]
#[test]
fn rejects_unreadable_files_and_directories_without_partial_results() {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let readable = directory.path().join("readable.txt");
    let file = directory.path().join("private.txt");
    let folder = directory.path().join("private");
    std::fs::write(&readable, "validation only").unwrap();
    std::fs::write(&file, "validation only").unwrap();
    std::fs::create_dir(&folder).unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0)).unwrap();
    std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0)).unwrap();
    // Privileged test runners can bypass UNIX permissions; only assert real denial.
    if std::fs::File::open(&file).is_err() {
        assert_eq!(
            airdrop_paths(&json!({"paths":[readable,file]}))
                .unwrap_err()
                .code,
            "invalid_paths"
        );
    }
    if std::fs::read_dir(&folder).is_err() {
        assert_eq!(
            airdrop_paths(&json!({"paths":[readable,folder]}))
                .unwrap_err()
                .code,
            "invalid_paths"
        );
    }
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
    std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o700)).unwrap();
}
