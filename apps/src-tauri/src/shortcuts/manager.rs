use crate::shortcuts::types::*;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use tauri::command;

static SHORTCUTS_MANAGER: LazyLock<Mutex<Option<ShortcutsManager>>> =
    LazyLock::new(|| Mutex::new(None));

#[derive(Debug, Clone)]
pub struct ShortcutsManager {
    pub settings: ShortcutSettings,
    pub current_profile_id: String,
    data_dir: PathBuf,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ShortcutKeyInput {
    pub key: String,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
}

/// Helper to build a ShortcutBinding concisely.
fn sb(
    id: &str,
    keys: &[&str],
    action: ShortcutAction,
    context: Option<String>,
    profile: &str,
    description: &str,
    key_combination: &str,
) -> ShortcutBinding {
    ShortcutBinding {
        id: id.to_string(),
        keys: keys.iter().map(|k| k.to_string()).collect(),
        action,
        context,
        enabled: true,
        profile: profile.to_string(),
        description: Some(description.to_string()),
        global: false,
        key_combination: key_combination.to_string(),
    }
}

/// Current built-in defaults version. Bump when defaults change so that
/// persisted profiles are re-synced from the new table (extension bindings
/// are preserved).
const SCHEMA_VERSION: u32 = 2;

impl ShortcutsManager {
    pub fn new(data_dir: &str) -> Self {
        let data_path = PathBuf::from(data_dir);
        let settings_path = data_path.join("shortcuts.json");

        let mut settings = if settings_path.exists() {
            match fs::read_to_string(&settings_path) {
                Ok(content) => {
                    serde_json::from_str(&content).unwrap_or_else(|_| Self::default_settings())
                }
                Err(_) => Self::default_settings(),
            }
        } else {
            Self::default_settings()
        };

        // Migrate persisted profiles written against older built-in defaults:
        // keep extension bindings (ids contain a dot), replace built-ins.
        if settings.schema_version < SCHEMA_VERSION {
            let defaults = Self::default_settings();
            for profile in &mut settings.profiles {
                let extension_shortcuts: Vec<ShortcutBinding> = profile
                    .shortcuts
                    .iter()
                    .filter(|s| s.id.contains('.'))
                    .cloned()
                    .collect();
                profile.shortcuts = default_profile_shortcuts(&defaults);
                profile.shortcuts.extend(extension_shortcuts);
            }
            settings.schema_version = SCHEMA_VERSION;
            let _ = fs::create_dir_all(&data_path);
            if let Ok(json) = serde_json::to_string_pretty(&settings) {
                let _ = fs::write(data_path.join("shortcuts.json"), json);
            }
        }

        let current_profile_id = settings.current_profile.clone();

        ShortcutsManager {
            settings,
            current_profile_id,
            data_dir: data_path,
        }
    }

    fn save_settings(&self) -> Result<(), String> {
        if let Err(e) = fs::create_dir_all(&self.data_dir) {
            return Err(format!("Failed to create shortcuts directory: {}", e));
        }
        let settings_path = self.data_dir.join("shortcuts.json");
        let json = serde_json::to_string_pretty(&self.settings)
            .map_err(|e| format!("Failed to serialize shortcuts: {}", e))?;
        fs::write(&settings_path, json)
            .map_err(|e| format!("Failed to write shortcuts file: {}", e))?;
        Ok(())
    }

    fn default_settings() -> ShortcutSettings {
        let profile = "default".to_string();
        let ctx = Some("file-explorer".to_string());

        ShortcutSettings {
            current_profile: "default".to_string(),
            global_shortcuts_enabled: true,
            context_aware: true,
            schema_version: SCHEMA_VERSION,
            profiles: vec![ShortcutProfile {
                id: "default".to_string(),
                name: "Default".to_string(),
                description: Some("Default shortcut profile".to_string()),
                shortcuts: vec![
                    // ── File Operations (Finder-aligned) ──
                    sb("copy", &["ctrl", "c"], ShortcutAction::Copy, ctx.clone(), &profile, "Copy selected items", "ctrl+c"),
                    sb("cut", &["ctrl", "x"], ShortcutAction::Cut, ctx.clone(), &profile, "Cut selected items", "ctrl+x"),
                    sb("paste", &["ctrl", "v"], ShortcutAction::Paste, ctx.clone(), &profile, "Paste items", "ctrl+v"),
                    sb("paste-move", &["ctrl", "alt", "v"], ShortcutAction::PasteMove, ctx.clone(), &profile, "Move clipboard items here (Finder ⌥⌘V)", "ctrl+alt+v"),
                    sb("delete", &["ctrl", "backspace"], ShortcutAction::Delete, ctx.clone(), &profile, "Move to trash", "ctrl+backspace"),
                    sb("rename", &["enter"], ShortcutAction::Rename, ctx.clone(), &profile, "Rename selected item", "enter"),
                    sb("rename-f2", &["f2"], ShortcutAction::Rename, ctx.clone(), &profile, "Rename selected item (F2 habit key)", "f2"),
                    sb("new-folder", &["ctrl", "shift", "n"], ShortcutAction::NewFolder, ctx.clone(), &profile, "Create new folder", "ctrl+shift+n"),
                    sb("new-file", &["ctrl", "alt", "n"], ShortcutAction::NewFile, ctx.clone(), &profile, "Create new file", "ctrl+alt+n"),
                    sb("duplicate", &["ctrl", "d"], ShortcutAction::Duplicate, ctx.clone(), &profile, "Duplicate selected files", "ctrl+d"),
                    sb("copy-path", &["ctrl", "alt", "c"], ShortcutAction::CopyPath, ctx.clone(), &profile, "Copy path of selected item", "ctrl+alt+c"),
                    sb("quick-look", &["space"], ShortcutAction::QuickLook, ctx.clone(), &profile, "Quick Look selected item", "space"),
                    sb("quick-look-y", &["ctrl", "y"], ShortcutAction::QuickLook, ctx.clone(), &profile, "Quick Look selected item", "ctrl+y"),
                    sb("open-selected", &["ctrl", "o"], ShortcutAction::Open, ctx.clone(), &profile, "Open selected item", "ctrl+o"),
                    sb("open-selected-down", &["ctrl", "down"], ShortcutAction::Open, ctx.clone(), &profile, "Open selected item", "ctrl+down"),
                    sb("properties", &["ctrl", "i"], ShortcutAction::Properties, ctx.clone(), &profile, "Show properties of selected item", "ctrl+i"),
                    // ── History (Finder ⌘Z / ⇧⌘Z) ──
                    sb("undo", &["ctrl", "z"], ShortcutAction::Undo, ctx.clone(), &profile, "Undo last operation", "ctrl+z"),
                    sb("redo", &["ctrl", "shift", "z"], ShortcutAction::Redo, ctx.clone(), &profile, "Redo undone operation", "ctrl+shift+z"),
                    // ── Navigation ──
                    sb("navigate-back", &["ctrl", "["], ShortcutAction::NavigateBack, ctx.clone(), &profile, "Go back", "ctrl+["),
                    sb("navigate-forward", &["ctrl", "]"], ShortcutAction::NavigateForward, ctx.clone(), &profile, "Go forward", "ctrl+]"),
                    sb("navigate-up", &["ctrl", "up"], ShortcutAction::NavigateUp, ctx.clone(), &profile, "Go to parent directory", "ctrl+up"),
                    sb("go-home", &["ctrl", "shift", "h"], ShortcutAction::GoHome, ctx.clone(), &profile, "Go to home directory", "ctrl+shift+h"),
                    sb("go-to-path", &["ctrl", "shift", "g"], ShortcutAction::GoToPath, ctx.clone(), &profile, "Go to folder (focus address bar)", "ctrl+shift+g"),
                    sb(
                        "go-desktop",
                        &["ctrl", "shift", "d"],
                        ShortcutAction::GoToSpecial { folder: "desktop".into() },
                        ctx.clone(),
                        &profile,
                        "Go to Desktop",
                        "ctrl+shift+d",
                    ),
                    sb(
                        "go-downloads",
                        &["ctrl", "alt", "l"],
                        ShortcutAction::GoToSpecial { folder: "downloads".into() },
                        ctx.clone(),
                        &profile,
                        "Go to Downloads",
                        "ctrl+alt+l",
                    ),
                    sb(
                        "go-documents",
                        &["ctrl", "shift", "o"],
                        ShortcutAction::GoToSpecial { folder: "documents".into() },
                        ctx.clone(),
                        &profile,
                        "Go to Documents",
                        "ctrl+shift+o",
                    ),
                    sb(
                        "go-applications",
                        &["ctrl", "shift", "a"],
                        ShortcutAction::GoToSpecial { folder: "applications".into() },
                        ctx.clone(),
                        &profile,
                        "Go to Applications",
                        "ctrl+shift+a",
                    ),
                    // ── Selection ──
                    sb("select-all", &["ctrl", "a"], ShortcutAction::SelectAll, ctx.clone(), &profile, "Select all files", "ctrl+a"),
                    sb("invert-selection", &["ctrl", "shift", "i"], ShortcutAction::InvertSelection, ctx.clone(), &profile, "Invert selection", "ctrl+shift+i"),
                    sb("clear-selection", &["esc"], ShortcutAction::ClearSelection, ctx.clone(), &profile, "Clear selection", "esc"),
                    // ── Search ──
                    sb("search", &["ctrl", "f"], ShortcutAction::Search, ctx.clone(), &profile, "Open search", "ctrl+f"),
                    sb("quick-search", &["ctrl", "p"], ShortcutAction::QuickSearch, ctx.clone(), &profile, "Quick search (command palette)", "ctrl+p"),
                    sb("natural-language-search", &["ctrl", "shift", "f"], ShortcutAction::NaturalLanguageSearch, ctx.clone(), &profile, "AI-powered search", "ctrl+shift+f"),
                    // ── View (Finder ⌥⌘S sidebar, ⇧⌘P preview, ⌘1-⌘4 view modes, ⇧⌘. hidden) ──
                    sb("toggle-left-sidebar", &["ctrl", "alt", "s"], ShortcutAction::ToggleLeftSidebar, ctx.clone(), &profile, "Toggle left sidebar", "ctrl+alt+s"),
                    sb("toggle-right-sidebar", &["ctrl", "shift", "b"], ShortcutAction::ToggleRightSidebar, ctx.clone(), &profile, "Toggle right sidebar", "ctrl+shift+b"),
                    sb("toggle-bottom-panel", &["ctrl", "j"], ShortcutAction::ToggleBottomPanel, ctx.clone(), &profile, "Toggle bottom panel", "ctrl+j"),
                    sb("toggle-preview", &["ctrl", "shift", "p"], ShortcutAction::TogglePreview, ctx.clone(), &profile, "Toggle preview panel", "ctrl+shift+p"),
                    sb(
                        "view-icons",
                        &["ctrl", "1"],
                        ShortcutAction::SetViewMode { mode: "medium".into() },
                        ctx.clone(),
                        &profile,
                        "Icon view",
                        "ctrl+1",
                    ),
                    sb(
                        "view-list",
                        &["ctrl", "2"],
                        ShortcutAction::SetViewMode { mode: "details".into() },
                        ctx.clone(),
                        &profile,
                        "List view",
                        "ctrl+2",
                    ),
                    sb(
                        "view-column",
                        &["ctrl", "3"],
                        ShortcutAction::SetViewMode { mode: "column".into() },
                        ctx.clone(),
                        &profile,
                        "Column view",
                        "ctrl+3",
                    ),
                    sb(
                        "view-gallery",
                        &["ctrl", "4"],
                        ShortcutAction::SetViewMode { mode: "gallery".into() },
                        ctx.clone(),
                        &profile,
                        "Gallery view",
                        "ctrl+4",
                    ),
                    sb("refresh", &["f5"], ShortcutAction::Refresh, ctx.clone(), &profile, "Refresh directory", "f5"),
                    sb("toggle-hidden", &["ctrl", "shift", "."], ShortcutAction::ToggleHiddenFiles, ctx.clone(), &profile, "Toggle hidden files", "ctrl+shift+."),
                    sb("zoom-in", &["ctrl", "="], ShortcutAction::ZoomIn, ctx.clone(), &profile, "Zoom in", "ctrl+="),
                    sb("zoom-out", &["ctrl", "-"], ShortcutAction::ZoomOut, ctx.clone(), &profile, "Zoom out", "ctrl+-"),
                    // ── Application ──
                    sb("open-settings", &["ctrl", ","], ShortcutAction::OpenSettings, ctx.clone(), &profile, "Open settings", "ctrl+,"),
                    sb("new-tab", &["ctrl", "t"], ShortcutAction::NewTab, ctx.clone(), &profile, "Open new tab", "ctrl+t"),
                    sb("close-tab", &["ctrl", "w"], ShortcutAction::CloseTab, ctx.clone(), &profile, "Close current tab", "ctrl+w"),
                    sb("next-tab", &["ctrl", "tab"], ShortcutAction::NextTab, ctx.clone(), &profile, "Switch to next tab", "ctrl+tab"),
                    sb("prev-tab", &["ctrl", "shift", "tab"], ShortcutAction::PreviousTab, ctx.clone(), &profile, "Switch to previous tab", "ctrl+shift+tab"),
                    sb("toggle-fullscreen", &["ctrl", "alt", "f"], ShortcutAction::ToggleFullscreen, ctx.clone(), &profile, "Toggle fullscreen (Finder ⌃⌘F)", "ctrl+alt+f"),
                    sb("toggle-fullscreen-f11", &["f11"], ShortcutAction::ToggleFullscreen, ctx.clone(), &profile, "Toggle fullscreen (F11 habit key)", "f11"),
                    sb("new-window", &["ctrl", "n"], ShortcutAction::NewWindow, ctx.clone(), &profile, "Open new window", "ctrl+n"),
                    sb("quit", &["ctrl", "q"], ShortcutAction::Quit, ctx.clone(), &profile, "Quit application", "ctrl+q"),
                    // ── Panels, dialogs & split panes ──
                    sb("shortcuts-dialog", &["ctrl", "/"], ShortcutAction::ToggleShortcutsDialog, ctx.clone(), &profile, "Show shortcut cheat sheet", "ctrl+/"),
                    sb("shortcuts-dialog-shift", &["shift", "/"], ShortcutAction::ToggleShortcutsDialog, ctx.clone(), &profile, "Show shortcut cheat sheet", "shift+/"),
                    sb("workspace-layout", &["ctrl", "shift", "l"], ShortcutAction::ToggleWorkspaceLayoutDialog, ctx.clone(), &profile, "Toggle workspace layout dialog", "ctrl+shift+l"),
                    sb("path-bookmarks", &["ctrl", "b"], ShortcutAction::ToggleBookmarksDialog, ctx.clone(), &profile, "Toggle path bookmarks dialog", "ctrl+b"),
                    sb("split-vertical", &["ctrl", "\\"], ShortcutAction::SplitPaneVertical, ctx.clone(), &profile, "Split pane vertically", "ctrl+\\"),
                    sb("split-horizontal", &["ctrl", "shift", "\\"], ShortcutAction::SplitPaneHorizontal, ctx.clone(), &profile, "Split pane horizontally", "ctrl+shift+\\"),
                    // ── Terminal / AI ──
                    sb("open-terminal", &["ctrl", "`"], ShortcutAction::OpenTerminal, ctx.clone(), &profile, "Open terminal", "ctrl+`"),
                    sb("agent-launcher", &["ctrl", "k"], ShortcutAction::ToggleAgentLauncher, ctx.clone(), &profile, "Toggle AI agent launcher", "ctrl+k"),
                    sb("agent-workspace", &["ctrl", "alt", "a"], ShortcutAction::ToggleAgentWorkspace, ctx.clone(), &profile, "Toggle AI agent workspace", "ctrl+alt+a"),
                ],
            }],
        }
    }
}

fn parse_action(action: &str, extension_id: Option<String>) -> ShortcutAction {
    match action {
        "Copy" => ShortcutAction::Copy,
        "CopyPath" => ShortcutAction::CopyPath,
        "Open" => ShortcutAction::Open,
        "Properties" => ShortcutAction::Properties,
        "Cut" => ShortcutAction::Cut,
        "Paste" => ShortcutAction::Paste,
        "PasteMove" | "MoveHere" => ShortcutAction::PasteMove,
        "Delete" => ShortcutAction::Delete,
        "Rename" => ShortcutAction::Rename,
        "NewFile" => ShortcutAction::NewFile,
        "NewFolder" => ShortcutAction::NewFolder,
        "Duplicate" => ShortcutAction::Duplicate,
        "QuickLook" => ShortcutAction::QuickLook,
        "Undo" => ShortcutAction::Undo,
        "Redo" => ShortcutAction::Redo,
        "NavigateUp" | "GoUp" => ShortcutAction::NavigateUp,
        "NavigateBack" | "GoBack" => ShortcutAction::NavigateBack,
        "NavigateForward" | "GoForward" => ShortcutAction::NavigateForward,
        "GoHome" => ShortcutAction::GoHome,
        "GoToPath" => ShortcutAction::GoToPath,
        "GoToSpecial" => ShortcutAction::GoToSpecial {
            folder: "home".to_string(),
        },
        "Refresh" => ShortcutAction::Refresh,
        "ToggleHiddenFiles" | "ToggleHidden" => ShortcutAction::ToggleHiddenFiles,
        "TogglePreview" => ShortcutAction::TogglePreview,
        "ToggleLeftSidebar" | "ToggleSidebar" | "ToggleDetails" => {
            ShortcutAction::ToggleLeftSidebar
        }
        "ToggleRightSidebar" | "ToggleGrid" => ShortcutAction::ToggleRightSidebar,
        "ToggleBottomPanel" => ShortcutAction::ToggleBottomPanel,
        "SwitchViewMode" => ShortcutAction::SwitchViewMode,
        "SetViewMode" => ShortcutAction::SetViewMode {
            mode: "details".to_string(),
        },
        "ZoomIn" => ShortcutAction::ZoomIn,
        "ZoomOut" => ShortcutAction::ZoomOut,
        "Search" => ShortcutAction::Search,
        "QuickSearch" => ShortcutAction::QuickSearch,
        "NaturalLanguageSearch" => ShortcutAction::NaturalLanguageSearch,
        "FilterFiles" | "Filter" => ShortcutAction::FilterFiles,
        "ClearFilter" => ShortcutAction::ClearFilter,
        "SelectAll" => ShortcutAction::SelectAll,
        "ClearSelection" | "SelectNone" => ShortcutAction::ClearSelection,
        "InvertSelection" => ShortcutAction::InvertSelection,
        "OpenSettings" => ShortcutAction::OpenSettings,
        "ToggleFullscreen" | "Fullscreen" => ShortcutAction::ToggleFullscreen,
        "Quit" => ShortcutAction::Quit,
        "NewWindow" => ShortcutAction::NewWindow,
        "NewTab" => ShortcutAction::NewTab,
        "CloseTab" => ShortcutAction::CloseTab,
        "NextTab" => ShortcutAction::NextTab,
        "PreviousTab" => ShortcutAction::PreviousTab,
        "ToggleShortcutsDialog" => ShortcutAction::ToggleShortcutsDialog,
        "ToggleWorkspaceLayoutDialog" => ShortcutAction::ToggleWorkspaceLayoutDialog,
        "ToggleBookmarksDialog" | "ShowPathBookmarks" => ShortcutAction::ToggleBookmarksDialog,
        "SplitPaneVertical" => ShortcutAction::SplitPaneVertical,
        "SplitPaneHorizontal" => ShortcutAction::SplitPaneHorizontal,
        "OpenTerminal" | "FocusTerminal" => ShortcutAction::OpenTerminal,
        "ToggleAgentLauncher" => ShortcutAction::ToggleAgentLauncher,
        "ToggleAgentWorkspace" => ShortcutAction::ToggleAgentWorkspace,
        "OpenAIAssistant" => ShortcutAction::OpenAIAssistant,
        "OpenExtensions" => ShortcutAction::OpenExtensions,
        _ => ShortcutAction::ExtensionAction {
            extension_id: extension_id.unwrap_or_else(|| "unknown".to_string()),
            action_id: action.to_string(),
            params: Some(HashMap::new()),
        },
    }
}

fn format_key_combination(key: &ShortcutKeyInput) -> String {
    let mut parts = Vec::new();
    if key.ctrl || key.meta {
        parts.push("ctrl".to_string());
    }
    if key.alt {
        parts.push("alt".to_string());
    }
    if key.shift {
        parts.push("shift".to_string());
    }
    parts.push(key.key.to_lowercase());
    parts.join("+")
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

#[command]
pub fn get_shortcuts() -> Result<Vec<ShortcutBinding>, String> {
    let manager_guard = SHORTCUTS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(manager) = manager_guard.as_ref() {
        let shortcuts = manager
            .settings
            .profiles
            .iter()
            .find(|p| p.id == manager.current_profile_id)
            .map(|p| p.shortcuts.clone())
            .unwrap_or_default();
        Ok(shortcuts)
    } else {
        Err("Shortcuts manager not initialized".to_string())
    }
}

#[command]
pub fn get_shortcuts_by_category(_category: String) -> Result<Vec<ShortcutBinding>, String> {
    get_shortcuts()
}

#[command]
pub fn add_shortcut(shortcut: ShortcutBinding) -> Result<(), String> {
    let mut manager_guard = SHORTCUTS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(manager) = manager_guard.as_mut() {
        for profile in &manager.settings.profiles {
            if profile.id == shortcut.profile {
                for existing in &profile.shortcuts {
                    if existing.keys == shortcut.keys && existing.context == shortcut.context {
                        return Err(format!(
                            "Shortcut conflict with existing binding: {}",
                            existing.id
                        ));
                    }
                }
            }
        }

        let target_profile = shortcut.profile.clone();
        if let Some(profile) = manager
            .settings
            .profiles
            .iter_mut()
            .find(|p| p.id == target_profile)
        {
            profile.shortcuts.push(shortcut);
        } else {
            return Err(format!("Profile '{}' not found", target_profile));
        }

        manager.save_settings()?;
        Ok(())
    } else {
        Err("Shortcuts manager not initialized".to_string())
    }
}

#[command]
pub fn update_shortcut(binding: ShortcutBinding) -> Result<(), String> {
    let mut manager_guard = SHORTCUTS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(manager) = manager_guard.as_mut() {
        if let Some(profile) = manager
            .settings
            .profiles
            .iter_mut()
            .find(|p| p.id == binding.profile)
        {
            if let Some(existing) = profile.shortcuts.iter_mut().find(|s| s.id == binding.id) {
                *existing = binding;
                manager.save_settings()?;
                return Ok(());
            }
            return Err("Shortcut not found".to_string());
        }
        return Err("Profile not found".to_string());
    }
    Err("Shortcuts manager not initialized".to_string())
}

#[command]
pub fn remove_shortcut(shortcut_id: String) -> Result<(), String> {
    let mut manager_guard = SHORTCUTS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(manager) = manager_guard.as_mut() {
        for profile in &mut manager.settings.profiles {
            let before = profile.shortcuts.len();
            profile.shortcuts.retain(|s| s.id != shortcut_id);
            if profile.shortcuts.len() != before {
                manager.save_settings()?;
                return Ok(());
            }
        }
        return Err("Shortcut not found".to_string());
    }
    Err("Shortcuts manager not initialized".to_string())
}

#[command]
pub fn get_shortcut_profiles() -> Result<Vec<String>, String> {
    let manager_guard = SHORTCUTS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(manager) = manager_guard.as_ref() {
        let profiles = manager
            .settings
            .profiles
            .iter()
            .map(|p| p.id.clone())
            .collect();
        Ok(profiles)
    } else {
        Err("Shortcuts manager not initialized".to_string())
    }
}

#[command]
pub fn switch_shortcut_profile(profile_id: String) -> Result<(), String> {
    let mut manager_guard = SHORTCUTS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(manager) = manager_guard.as_mut() {
        if manager.settings.profiles.iter().any(|p| p.id == profile_id) {
            manager.current_profile_id = profile_id.clone();
            manager.settings.current_profile = profile_id;
            manager.save_settings()?;
            return Ok(());
        }
        return Err("Profile not found".to_string());
    }
    Err("Shortcuts manager not initialized".to_string())
}

#[command]
pub fn get_shortcut_settings() -> Result<ShortcutSettings, String> {
    let manager_guard = SHORTCUTS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(manager) = manager_guard.as_ref() {
        return Ok(manager.settings.clone());
    }
    Err("Shortcuts manager not initialized".to_string())
}

#[command]
pub fn update_shortcut_settings(settings: ShortcutSettings) -> Result<(), String> {
    let mut manager_guard = SHORTCUTS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(manager) = manager_guard.as_mut() {
        manager.current_profile_id = settings.current_profile.clone();
        manager.settings = settings;
        manager.save_settings()?;
        return Ok(());
    }
    Err("Shortcuts manager not initialized".to_string())
}

#[command]
pub fn execute_shortcut_action(
    key_combination: String,
    context: String,
) -> Result<Option<ShortcutAction>, String> {
    let manager_guard = SHORTCUTS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(manager) = manager_guard.as_ref() {
        let action = manager
            .settings
            .profiles
            .iter()
            .find(|p| p.id == manager.current_profile_id)
            .and_then(|p| {
                p.shortcuts.iter().find(|s| {
                    s.enabled
                        && s.key_combination == key_combination
                        && (s.context.is_none() || s.context.as_ref() == Some(&context))
                })
            })
            .map(|s| s.action.clone());
        return Ok(action);
    }
    Err("Shortcuts manager not initialized".to_string())
}

#[command]
pub fn register_extension_shortcut(
    extension_id: String,
    shortcut_id: String,
    name: String,
    description: Option<String>,
    key_combination: ShortcutKeyInput,
    action: String,
    context: Vec<String>,
) -> Result<(), String> {
    let mut manager_guard = SHORTCUTS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(manager) = manager_guard.as_mut() {
        let current_profile = manager.current_profile_id.clone();
        let Some(profile) = manager
            .settings
            .profiles
            .iter_mut()
            .find(|p| p.id == current_profile)
        else {
            return Err("Current profile not found".to_string());
        };

        let key_string = format_key_combination(&key_combination);
        let keys: Vec<String> = key_string.split('+').map(|v| v.to_string()).collect();

        profile.shortcuts.push(ShortcutBinding {
            id: format!("{}.{}", extension_id, shortcut_id),
            keys,
            action: parse_action(&action, Some(extension_id)),
            context: context.first().cloned(),
            enabled: true,
            profile: profile.id.clone(),
            description: description.or(Some(name)),
            global: false,
            key_combination: key_string,
        });

        manager.save_settings()?;
        return Ok(());
    }
    Err("Shortcuts manager not initialized".to_string())
}

#[command]
pub fn unregister_extension_shortcuts(extension_id: String) -> Result<(), String> {
    let mut manager_guard = SHORTCUTS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(manager) = manager_guard.as_mut() {
        for profile in &mut manager.settings.profiles {
            profile
                .shortcuts
                .retain(|s| !s.id.starts_with(&format!("{}.", extension_id)));
        }
        manager.save_settings()?;
        return Ok(());
    }
    Err("Shortcuts manager not initialized".to_string())
}

#[command]
pub fn reset_shortcuts(profile_id: Option<String>) -> Result<(), String> {
    let mut manager_guard = SHORTCUTS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(manager) = manager_guard.as_mut() {
        let defaults = ShortcutsManager::default_settings();
        let target_id = profile_id.unwrap_or_else(|| manager.current_profile_id.clone());
        if let Some(profile) = manager
            .settings
            .profiles
            .iter_mut()
            .find(|p| p.id == target_id)
        {
            // Keep extension shortcuts (ids contain a dot), reset only built-in ones
            let extension_shortcuts: Vec<ShortcutBinding> = profile
                .shortcuts
                .iter()
                .filter(|s| s.id.contains('.'))
                .cloned()
                .collect();
            profile.shortcuts = default_profile_shortcuts(&defaults);
            profile.shortcuts.extend(extension_shortcuts);
            manager.settings.schema_version = defaults.schema_version;
        }
        manager.save_settings()?;
        Ok(())
    } else {
        Err("Shortcuts manager not initialized".to_string())
    }
}

#[command]
pub fn reset_single_shortcut(shortcut_id: String) -> Result<ShortcutBinding, String> {
    let mut manager_guard = SHORTCUTS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(manager) = manager_guard.as_mut() {
        let defaults = ShortcutsManager::default_settings();
        let default_binding = defaults
            .profiles
            .first()
            .and_then(|p| p.shortcuts.iter().find(|s| s.id == shortcut_id))
            .cloned()
            .ok_or_else(|| format!("No default found for shortcut '{}'", shortcut_id))?;

        let current_profile = manager.current_profile_id.clone();
        if let Some(profile) = manager
            .settings
            .profiles
            .iter_mut()
            .find(|p| p.id == current_profile)
        {
            if let Some(existing) = profile.shortcuts.iter_mut().find(|s| s.id == shortcut_id) {
                *existing = default_binding.clone();
            }
        }
        manager.save_settings()?;
        Ok(default_binding)
    } else {
        Err("Shortcuts manager not initialized".to_string())
    }
}

fn default_profile_shortcuts(settings: &ShortcutSettings) -> Vec<ShortcutBinding> {
    settings
        .profiles
        .first()
        .map(|p| p.shortcuts.clone())
        .unwrap_or_default()
}

#[command]
pub fn register_global_shortcuts() -> Result<(), String> {
    Ok(())
}

#[command]
pub fn unregister_global_shortcuts() -> Result<(), String> {
    Ok(())
}

#[command]
pub fn toggle_global_shortcuts(enabled: bool) -> Result<(), String> {
    let mut manager_guard = SHORTCUTS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(manager) = manager_guard.as_mut() {
        manager.settings.global_shortcuts_enabled = enabled;
        manager.save_settings()?;
        return Ok(());
    }
    Err("Shortcuts manager not initialized".to_string())
}

pub fn init_shortcuts_manager(data_dir: &str) {
    let mut manager_guard = SHORTCUTS_MANAGER.lock().unwrap_or_else(|e| e.into_inner());
    *manager_guard = Some(ShortcutsManager::new(data_dir));
}
