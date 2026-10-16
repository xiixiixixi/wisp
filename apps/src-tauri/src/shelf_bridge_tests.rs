use super::*;

#[test]
fn menu_snapshot_uses_actual_shelves_and_cleans_display_names() {
    let menu = MenuSnapshot::from_state(&json!({
        "supported": true,
        "shelves": [{"id":"one", "name":"Report\nFiles", "items":[{},{}], "pinned":true, "visible":true},
            {"id":"collapsed", "name":"收起的架子", "items":[], "visible":false},
            {"id":"invalid"}],
        // 旧引擎可能仍带 recentlyClosed 字段：必须被宽容忽略，不影响 shelves。
        "recentlyClosed": [{"id":"legacy", "name":"Earlier", "items":[]}]
    }));
    assert!(menu.supported);
    assert_eq!(menu.active.len(), 2);
    assert_eq!(
        menu.active[0],
        MenuShelf {
            id: "one".into(),
            name: "Report Files".into(),
            count: 2,
            pinned: true,
            visible: true
        }
    );
    assert_eq!(menu.active[1].visible, false);
    assert!(!MenuSnapshot::from_state(&unavailable(None)).supported);
}

#[test]
fn menu_commands_preserve_new_clipboard_semantics() {
    assert_eq!(menu_request("shelf-new"), Some(json!({"action":"create"})));
    assert_eq!(
        menu_request("shelf-new-clipboard"),
        Some(json!({"action":"clipboard", "forceNew":true}))
    );
    assert_eq!(
        menu_request("shelf-show:one"),
        Some(json!({"action":"show", "shelfId":"one"}))
    );
    for id in [
        "shelf-show:",
        "shelf-show:one:two",
        "shelf-remove:one",
        // A1：最近关闭的菜单分发已废除。
        "shelf-reopen:one",
        "open-settings",
    ] {
        assert_eq!(menu_request(id), None);
    }
}

#[test]
fn menu_navigation_waits_for_listener_and_survives_frontend_reload() {
    let mut state = NavigationState::default();
    let page = |target: &str| ShelfNavigation::Page(target.into());
    assert_eq!(state.navigate(page("shelves")), None);
    assert_eq!(state.navigate(page("settings")), None);
    assert_eq!(state.ready(), Some(page("settings")));
    assert_eq!(state.navigate(page("shelves")), Some(page("shelves")));
    state.loading();
    assert_eq!(state.navigate(page("settings")), None);
    assert_eq!(state.ready(), Some(page("settings")));
    assert_eq!(state.ready(), None);
}

#[test]
fn tray_drop_only_accepts_bounded_local_file_urls() {
    assert_eq!(
        tray_file_paths(&[
            "file:///tmp/a%20b.png".into(),
            "file://localhost/tmp/folder".into()
        ])
        .unwrap(),
        vec!["/tmp/a b.png", "/tmp/folder"]
    );
    assert!(tray_file_paths(&[]).is_err());
    assert!(tray_file_paths(&vec!["file:///tmp/one".into(); 257]).is_err());
    for raw in [
        "https://example.com/file",
        "file://other-host/tmp/file",
        "file:///tmp/a?x=1",
        "file:///tmp/a#fragment",
        "not a url",
    ] {
        assert!(tray_file_paths(&[raw.into()]).is_err(), "{raw}");
    }
}

#[cfg(target_os = "macos")]
fn waiting_child() -> std::sync::Mutex<std::process::Child> {
    std::sync::Mutex::new(
        std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg("cat >/dev/null")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("start the isolated stdin reader"),
    )
}

#[cfg(target_os = "macos")]
#[test]
fn state_reads_use_a_shorter_timeout_than_mutations() {
    assert_eq!(
        native::request_timeout(&json!({"action": "snapshot"})),
        std::time::Duration::from_secs(15)
    );
    for action in ["create", "settings", "context", "removeCloudAccount"] {
        assert_eq!(
            native::request_timeout(&json!({"action": action})),
            std::time::Duration::from_secs(120)
        );
    }
}

#[cfg(target_os = "macos")]
#[test]
fn shutdown_waits_for_actual_exit_after_input_is_closed() {
    let child = waiting_child();
    child.lock().unwrap().stdin.take();
    assert!(native::wait_for_child_exit(&child, std::time::Duration::from_secs(2)).is_ok());
    assert!(child.lock().unwrap().try_wait().unwrap().is_some());
}

#[cfg(target_os = "macos")]
#[test]
fn shutdown_exit_timeout_does_not_kill_the_child() {
    let child = waiting_child();
    let result = native::wait_for_child_exit(&child, std::time::Duration::from_millis(60));
    let still_running = child.lock().unwrap().try_wait().unwrap().is_none();
    child.lock().unwrap().stdin.take();
    let cleanup = native::wait_for_child_exit(&child, std::time::Duration::from_secs(2));

    assert!(result.is_err());
    assert!(still_running);
    assert!(cleanup.is_ok());
}

#[test]
fn rejects_unrecognised_commands_and_public_shutdown() {
    assert!(validate_request(&json!({"action":"snapshot"})).is_ok());
    assert!(
        validate_request(&json!({"action":"settings","settings":{"shakeEnabled":false}})).is_ok()
    );
    assert!(validate_request(&json!({
        "action": "removeCloudAccount",
        "accountId": "0494B794-C6E0-4E4D-A489-6852F950BC23"
    }))
    .is_ok());
    // 管理页「删除架子」走 remove；close 保留为「收起」语义。
    assert!(validate_request(&json!({"action":"remove","shelfId":"one"})).is_ok());
    assert!(validate_request(&json!({"action":"reopen","shelfId":"one"})).is_err());
    assert!(validate_request(&json!({"action":"shutdown"})).is_err());
    assert!(validate_request(&json!({"action":"arbitraryShellCommand"})).is_err());
    assert!(validate_request(&Value::Null).is_err());
}
#[test]
fn unsupported_snapshot_has_no_synthetic_shelves() {
    let state = unavailable(None);
    assert_eq!(state["supported"], false);
    assert_eq!(state["shelves"], json!([]));
    assert!(state.get("recentlyClosed").is_none());
}
#[test]
fn automation_only_accepts_explicit_local_collection_urls() {
    let valid =
        tauri::Url::parse("wisp-shelf://collect?file=file%3A%2F%2F%2Ftmp%2Fa%2520b.png").unwrap();
    assert!(matches!(
        open_command(&valid).unwrap(),
        Some(ShelfOpenCommand::Collect(paths)) if paths == vec!["/tmp/a b.png".to_string()]
    ));
    for url in [
        "wisp-shelf://collect",
        "wisp-shelf://collect?file=https://example.com/image.png",
        "wisp-shelf://collect?command=delete",
        "wisp-shelf://other?file=file:///tmp/test",
    ] {
        assert!(open_command(&tauri::Url::parse(url).unwrap()).is_err());
    }
    assert!(matches!(
        open_command(&tauri::Url::parse("file:///tmp/test").unwrap()).unwrap(),
        None
    ));
}

/// #26：URL 子命令 shelf/new 与 shelf/last——动词白名单 + 同 collect 的严格校验。
#[test]
fn url_verbs_new_and_last_are_whitelisted_and_strict() {
    for (url, expected_new, expected_last) in [
        ("wisp-shelf://shelf/new", true, false),
        ("wisp-shelf://shelf/last", false, true),
    ] {
        let command = open_command(&tauri::Url::parse(url).unwrap())
            .unwrap()
            .expect("verb must parse");
        assert_eq!(matches!(command, ShelfOpenCommand::NewShelf), expected_new);
        assert_eq!(matches!(command, ShelfOpenCommand::LastShelf), expected_last);
    }
    // 未知动词、多余路径段、查询串、凭据、端口、片段一律拒绝。
    for url in [
        "wisp-shelf://shelf/open",
        "wisp-shelf://shelf/new/extra",
        "wisp-shelf://shelf/new?force=1",
        "wisp-shelf://user@shelf/new",
        "wisp-shelf://user:pass@shelf/new",
        "wisp-shelf://shelf:8080/new",
        "wisp-shelf://shelf/new#fragment",
        "wisp-shelf://Shelf/new",
    ] {
        assert!(
            open_command(&tauri::Url::parse(url).unwrap()).is_err(),
            "must reject {url}"
        );
    }
}

/// #2：托盘/应用菜单分组——固定/其他只收可见架，收起的架子单独成组。
#[test]
fn menu_groups_move_collapsed_shelves_into_their_own_group() {
    let entry = |id: &str, pinned: bool, visible: bool| crate::shelf::MenuShelf {
        id: id.into(),
        name: id.into(),
        count: 1,
        pinned,
        visible,
    };
    let snapshot = crate::shelf::MenuSnapshot {
        supported: true,
        active: vec![
            entry("a", false, true),
            entry("b", true, true),
            entry("c", false, false),
            entry("d", true, false),
            entry("e", false, true),
        ],
    };
    let groups = crate::shelf::menu_groups(&snapshot);
    assert_eq!(
        groups.pinned.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
        vec!["b"]
    );
    // 其他组按「最近优先」倒序取。
    assert_eq!(
        groups.other.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
        vec!["e", "a"]
    );
    // 收起组不区分是否固定，最近收起的排最前。
    assert_eq!(
        groups.collapsed.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
        vec!["d", "c"]
    );
    // 无收起架子时该组为空（菜单侧据此隐藏整组）。
    let all_visible = crate::shelf::MenuSnapshot {
        supported: true,
        active: vec![entry("a", false, true)],
    };
    assert!(crate::shelf::menu_groups(&all_visible).collapsed.is_empty());
}

/// 三端动作白名单同步：引擎端实现的云测试/历史操作必须放行到 hosted 请求。
#[test]
fn actions_whitelist_covers_engine_cloud_and_reopen_verbs() {
    for action in [
        "showLast",
        "testCloudAccount",
        "removeCloudRecord",
        "revokeCloudRecord",
    ] {
        assert!(
            ACTIONS.contains(&action),
            "whitelist must keep engine verb {action}"
        );
    }
}
