use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ShortcutAction {
    // File operations
    Copy,
    CopyPath,
    Cut,
    Paste,
    /// Finder's ⌥⌘V — paste the clipboard as a move instead of a copy
    PasteMove,
    Delete,
    Rename,
    NewFile,
    NewFolder,
    Duplicate,
    QuickLook,

    // Navigation
    #[serde(alias = "GoUp")]
    NavigateUp,
    #[serde(alias = "GoBack")]
    NavigateBack,
    #[serde(alias = "GoForward")]
    NavigateForward,
    GoHome,
    GoToPath,
    /// Jump to a well-known folder (desktop / downloads / documents / applications)
    GoToSpecial { folder: String },

    // History
    Undo,
    Redo,

    // View operations
    Refresh,
    #[serde(alias = "ToggleHidden")]
    ToggleHiddenFiles,
    TogglePreview,
    #[serde(alias = "ToggleSidebar", alias = "ToggleDetails")]
    ToggleLeftSidebar,
    #[serde(alias = "ToggleGrid")]
    ToggleRightSidebar,
    ToggleBottomPanel,
    SwitchViewMode,
    /// Switch directly to a named view mode (Finder's ⌘1-⌘4)
    SetViewMode { mode: String },
    ZoomIn,
    ZoomOut,

    // Search and filter
    Search,
    QuickSearch,
    NaturalLanguageSearch,
    #[serde(alias = "Filter")]
    FilterFiles,
    ClearFilter,

    // Selection
    SelectAll,
    #[serde(alias = "SelectNone")]
    ClearSelection,
    InvertSelection,

    // Application operations
    OpenSettings,
    #[serde(alias = "Fullscreen")]
    ToggleFullscreen,
    Quit,
    NewWindow,
    NewTab,
    CloseTab,
    NextTab,
    PreviousTab,

    // Panels, dialogs & panes
    ToggleShortcutsDialog,
    ToggleWorkspaceLayoutDialog,
    ToggleBookmarksDialog,
    SplitPaneVertical,
    SplitPaneHorizontal,

    // Terminal / AI
    #[serde(alias = "FocusTerminal")]
    OpenTerminal,
    ToggleAgentLauncher,
    ToggleAgentWorkspace,
    OpenAIAssistant,
    OpenExtensions,

    // Extension operations
    ExtensionAction {
        extension_id: String,
        action_id: String,
        params: Option<HashMap<String, String>>,
    },

    // Legacy (kept for backward compat)
    Save,
    SaveAs,
    Open,
    OpenWith,
    Properties,
    FocusExplorer,
    FocusSearch,
    Minimize,
    Maximize,
    Cancel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutBinding {
    pub id: String,
    pub keys: Vec<String>, // e.g., ["ctrl", "c"]
    pub action: ShortcutAction,
    pub context: Option<String>, // Where this shortcut is active
    pub enabled: bool,
    pub profile: String,
    pub description: Option<String>,
    pub global: bool,            // Whether this is a global system shortcut
    pub key_combination: String, // Combined representation
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutProfile {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub shortcuts: Vec<ShortcutBinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutSettings {
    pub current_profile: String,
    pub global_shortcuts_enabled: bool,
    pub context_aware: bool,
    /// Bump when built-in defaults change so persisted profiles re-sync
    /// (user-created extension bindings are preserved across migrations).
    #[serde(default)]
    pub schema_version: u32,
    pub profiles: Vec<ShortcutProfile>,
}
