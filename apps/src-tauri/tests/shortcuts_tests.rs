use std::collections::HashMap;
use tempfile::TempDir;
use wisp::shortcuts::manager::*;
use wisp::shortcuts::types::*;

#[test]
fn test_shortcut_action_serialization() {
    let action = ShortcutAction::Copy;
    let json = serde_json::to_string(&action).unwrap();
    let deserialized: ShortcutAction = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, ShortcutAction::Copy);
}

#[test]
fn test_shortcut_action_extension_action() {
    let mut params = HashMap::new();
    params.insert("theme".to_string(), "dark".to_string());

    let action = ShortcutAction::ExtensionAction {
        extension_id: "theme-switcher".to_string(),
        action_id: "toggle".to_string(),
        params: Some(params),
    };

    let json = serde_json::to_string(&action).unwrap();
    let deserialized: ShortcutAction = serde_json::from_str(&json).unwrap();

    match deserialized {
        ShortcutAction::ExtensionAction {
            extension_id,
            action_id,
            params,
        } => {
            assert_eq!(extension_id, "theme-switcher");
            assert_eq!(action_id, "toggle");
            assert!(params.is_some());
            assert_eq!(params.unwrap().get("theme").unwrap(), "dark");
        }
        _ => panic!("Expected ExtensionAction"),
    }
}

#[test]
fn test_shortcut_binding_serialization() {
    let binding = ShortcutBinding {
        id: "test_shortcut".to_string(),
        keys: vec!["ctrl".to_string(), "n".to_string()],
        action: ShortcutAction::NewFile,
        context: Some("explorer".to_string()),
        enabled: true,
        profile: "default".to_string(),
        description: Some("Test shortcut".to_string()),
        global: false,
        key_combination: "ctrl+n".to_string(),
    };

    let json = serde_json::to_string(&binding).unwrap();
    let deserialized: ShortcutBinding = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.id, "test_shortcut");
    assert_eq!(deserialized.keys, vec!["ctrl", "n"]);
    assert_eq!(deserialized.action, ShortcutAction::NewFile);
    assert_eq!(deserialized.context, Some("explorer".to_string()));
    assert!(deserialized.enabled);
    assert!(!deserialized.global);
    assert_eq!(deserialized.key_combination, "ctrl+n");
}

#[test]
fn test_shortcut_settings_serialization() {
    let settings = ShortcutSettings {
        current_profile: "default".to_string(),
        global_shortcuts_enabled: true,
        context_aware: true,
        schema_version: 2,
        profiles: vec![ShortcutProfile {
            id: "default".to_string(),
            name: "Default".to_string(),
            description: Some("Default profile".to_string()),
            shortcuts: vec![],
        }],
    };

    let json = serde_json::to_string(&settings).unwrap();
    let deserialized: ShortcutSettings = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.current_profile, "default");
    assert!(deserialized.global_shortcuts_enabled);
    assert!(deserialized.context_aware);
    assert_eq!(deserialized.profiles.len(), 1);
    assert_eq!(deserialized.profiles[0].id, "default");
}

#[test]
fn test_shortcuts_manager_default_settings() {
    let temp_dir = TempDir::new().unwrap();
    let manager = ShortcutsManager::new(temp_dir.path().to_str().unwrap());

    // The default profile should have shortcuts
    assert!(!manager.settings.profiles.is_empty());
    assert_eq!(manager.settings.current_profile, "default");
    assert_eq!(manager.current_profile_id, "default");

    // Default profile should have built-in shortcuts
    let default_profile = &manager.settings.profiles[0];
    assert_eq!(default_profile.id, "default");
    assert!(!default_profile.shortcuts.is_empty());
}

#[test]
fn test_shortcuts_manager_persistence() {
    let temp_dir = TempDir::new().unwrap();
    let data_dir = temp_dir.path().to_str().unwrap();

    // Create a manager and verify defaults
    let manager1 = ShortcutsManager::new(data_dir);
    let shortcut_count = manager1.settings.profiles[0].shortcuts.len();
    assert!(shortcut_count > 0);

    // Create a second manager from the same directory -- it should load saved settings
    let manager2 = ShortcutsManager::new(data_dir);
    assert_eq!(
        manager2.settings.profiles[0].shortcuts.len(),
        shortcut_count
    );
}

#[test]
fn test_shortcut_action_serde_aliases() {
    // Test that legacy aliases still deserialize correctly
    let json = r#""GoUp""#;
    let action: ShortcutAction = serde_json::from_str(json).unwrap();
    assert_eq!(action, ShortcutAction::NavigateUp);

    let json = r#""GoBack""#;
    let action: ShortcutAction = serde_json::from_str(json).unwrap();
    assert_eq!(action, ShortcutAction::NavigateBack);

    let json = r#""ToggleHidden""#;
    let action: ShortcutAction = serde_json::from_str(json).unwrap();
    assert_eq!(action, ShortcutAction::ToggleHiddenFiles);

    let json = r#""Fullscreen""#;
    let action: ShortcutAction = serde_json::from_str(json).unwrap();
    assert_eq!(action, ShortcutAction::ToggleFullscreen);
}

#[test]
fn test_all_shortcut_actions_roundtrip() {
    // Test a representative sample of actions for serialization round-trip
    let actions = vec![
        ShortcutAction::Copy,
        ShortcutAction::Cut,
        ShortcutAction::Paste,
        ShortcutAction::PasteMove,
        ShortcutAction::Delete,
        ShortcutAction::Rename,
        ShortcutAction::NewFile,
        ShortcutAction::NewFolder,
        ShortcutAction::QuickLook,
        ShortcutAction::Undo,
        ShortcutAction::Redo,
        ShortcutAction::NewTab,
        ShortcutAction::NavigateUp,
        ShortcutAction::NavigateBack,
        ShortcutAction::NavigateForward,
        ShortcutAction::GoHome,
        ShortcutAction::SetViewMode {
            mode: "gallery".to_string(),
        },
        ShortcutAction::GoToSpecial {
            folder: "downloads".to_string(),
        },
        ShortcutAction::ToggleShortcutsDialog,
        ShortcutAction::ToggleWorkspaceLayoutDialog,
        ShortcutAction::ToggleBookmarksDialog,
        ShortcutAction::SplitPaneVertical,
        ShortcutAction::SplitPaneHorizontal,
        ShortcutAction::ToggleAgentLauncher,
        ShortcutAction::ToggleAgentWorkspace,
        ShortcutAction::Refresh,
        ShortcutAction::Search,
        ShortcutAction::SelectAll,
        ShortcutAction::OpenSettings,
        ShortcutAction::Quit,
        ShortcutAction::OpenTerminal,
    ];

    for action in actions {
        let json = serde_json::to_string(&action).unwrap();
        let deserialized: ShortcutAction = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, action, "Round-trip failed for {:?}", action);
    }
}

#[test]
fn test_finder_aligned_defaults() {
    let temp_dir = TempDir::new().unwrap();
    let manager = ShortcutsManager::new(temp_dir.path().to_str().unwrap());
    let shortcuts = &manager.settings.profiles[0].shortcuts;

    let find = |id: &str| shortcuts.iter().find(|s| s.id == id).unwrap_or_else(|| panic!("missing binding '{}'", id));

    // Spot-check the Finder-aligned table
    assert_eq!(find("rename").key_combination, "enter");
    assert_eq!(find("delete").key_combination, "ctrl+backspace");
    assert_eq!(find("new-folder").key_combination, "ctrl+shift+n");
    assert_eq!(find("duplicate").key_combination, "ctrl+d");
    assert_eq!(find("copy-path").key_combination, "ctrl+alt+c");
    assert_eq!(find("paste-move").key_combination, "ctrl+alt+v");
    assert_eq!(find("quick-look").key_combination, "space");
    assert_eq!(find("undo").key_combination, "ctrl+z");
    assert_eq!(find("redo").key_combination, "ctrl+shift+z");
    assert_eq!(find("go-home").key_combination, "ctrl+shift+h");
    assert_eq!(find("go-to-path").key_combination, "ctrl+shift+g");
    assert_eq!(find("toggle-left-sidebar").key_combination, "ctrl+alt+s");
    assert_eq!(find("toggle-preview").key_combination, "ctrl+shift+p");
    assert_eq!(find("toggle-hidden").key_combination, "ctrl+shift+.");
    assert_eq!(find("new-tab").key_combination, "ctrl+t");
    assert_eq!(find("next-tab").key_combination, "ctrl+tab");
    assert_eq!(find("prev-tab").key_combination, "ctrl+shift+tab");
    assert_eq!(find("toggle-fullscreen").key_combination, "ctrl+alt+f");
    assert_eq!(find("open-settings").key_combination, "ctrl+,");
    assert_eq!(find("workspace-layout").key_combination, "ctrl+shift+l");
    assert_eq!(find("agent-workspace").key_combination, "ctrl+alt+a");

    // ⌘1-⌘4 select Finder's view modes
    assert_eq!(find("view-icons").action, ShortcutAction::SetViewMode { mode: "medium".into() });
    assert_eq!(find("view-list").action, ShortcutAction::SetViewMode { mode: "details".into() });
    assert_eq!(find("view-column").action, ShortcutAction::SetViewMode { mode: "column".into() });
    assert_eq!(find("view-gallery").action, ShortcutAction::SetViewMode { mode: "gallery".into() });

    // Go-to-folder bindings
    assert_eq!(find("go-desktop").key_combination, "ctrl+shift+d");
    assert_eq!(find("go-downloads").key_combination, "ctrl+alt+l");
    assert_eq!(find("go-documents").key_combination, "ctrl+shift+o");
    assert_eq!(find("go-applications").key_combination, "ctrl+shift+a");

    // No two enabled built-ins may share a key combination
    let mut seen = std::collections::HashSet::new();
    for s in shortcuts.iter().filter(|s| s.enabled) {
        assert!(
            seen.insert(s.key_combination.clone()),
            "duplicate key combination '{}' (binding '{}')",
            s.key_combination,
            s.id
        );
    }
}

#[test]
fn test_migration_replaces_old_defaults() {
    let temp_dir = TempDir::new().unwrap();
    let data_dir = temp_dir.path();
    let file = data_dir.join("shortcuts.json");

    // A v1 profile: old ⌘⇧L = SwitchViewMode, plus an extension binding that
    // must survive the migration.
    let old = serde_json::json!({
        "current_profile": "default",
        "global_shortcuts_enabled": true,
        "context_aware": true,
        "profiles": [{
            "id": "default",
            "name": "Default",
            "description": null,
            "shortcuts": [
                {
                    "id": "switch-view-mode",
                    "keys": ["ctrl", "shift", "l"],
                    "action": "SwitchViewMode",
                    "context": "file-explorer",
                    "enabled": true,
                    "profile": "default",
                    "description": "Cycle view mode",
                    "global": false,
                    "key_combination": "ctrl+shift+l"
                },
                {
                    "id": "my.ext.toggle",
                    "keys": ["ctrl", "shift", "9"],
                    "action": {"ExtensionAction": {"extension_id": "my", "action_id": "toggle"}},
                    "context": null,
                    "enabled": true,
                    "profile": "default",
                    "description": null,
                    "global": false,
                    "key_combination": "ctrl+shift+9"
                }
            ]
        }]
    });
    std::fs::write(&file, old.to_string()).unwrap();

    let manager = ShortcutsManager::new(data_dir.to_str().unwrap());

    // Old binding is gone; ⌘⇧L now opens the workspace layout dialog
    assert!(manager
        .settings
        .profiles[0]
        .shortcuts
        .iter()
        .all(|s| s.id != "switch-view-mode"));
    assert!(manager
        .settings
        .profiles[0]
        .shortcuts
        .iter()
        .any(|s| s.id == "workspace-layout" && s.key_combination == "ctrl+shift+l"));

    // Extension binding survives
    assert!(manager
        .settings
        .profiles[0]
        .shortcuts
        .iter()
        .any(|s| s.id == "my.ext.toggle"));

    // Version marker persisted so the migration doesn't run twice
    assert_eq!(manager.settings.schema_version, 2);
    let reread: ShortcutSettings =
        serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(reread.schema_version, 2);
}
