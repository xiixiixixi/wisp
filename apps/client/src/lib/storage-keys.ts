/**
 * Centralized registry of all localStorage keys used by Wisp.
 * Always reference these constants instead of hardcoding key strings.
 */
export const STORAGE_KEYS = {
  PI_DEFAULT_MODEL: 'wisp:pi-default-model',
  // Core settings & UI
  SETTINGS: 'wisp:settings',
  UI_STATE: 'wisp:ui-state',
  SPLIT_LAYOUT: 'wisp:split-layout',
  SMART_VIEW: 'wisp:folder-views',
  FOLDER_SETTINGS: 'wisp:folder-settings',

  // Marketplace / extensions
  MARKETPLACE_URL: 'wisp:marketplace-url',
  INSTALLED_EXTENSIONS: 'wisp-installed-extensions',
  PERMISSION_VIOLATIONS: 'wisp-permission-violations',

  // Search
  SEARCH_SCOPE: 'wisp:search-scope',
  SEARCH_HISTORY: 'wisp-search-history',
  COMMAND_HISTORY: 'wisp:command-history',
  COMMAND_FAVORITES: 'wisp:command-favorites',
  RECENT_CLI_COMMANDS: 'wisp:recent-cli-commands',

  // Explorer UI
  SIDEBAR_SECTIONS: 'wisp-sidebar-sections',
  SIDEBAR_HEIGHTS: 'wisp-sidebar-heights',
  VIEW_DEFAULT_MIGRATED: 'wisp:view-default-migrated',

  // Collections, bookmarks, colors
  COLLECTIONS: 'wisp:collections',
  PATH_BOOKMARKS: 'wisp:path-bookmarks',
  FOLDER_COLORS: 'wisp:folder-colors',

  // First-run notice and indexing preferences
  BETA_WARNING_DISMISSED: 'wisp:beta-warning-dismissed',
  AUTO_WHITELIST_VISITED: 'wisp:auto-whitelist-visited',

  // Pane sync
  PANE_SYNC_ENABLED: 'wisp:pane-sync-enabled',
  PANE_SYNC_MODE: 'wisp:pane-sync-mode',

  // Vim mode
  VIM_MODE: 'wisp-vim-mode',
  VIM_LEARNING_MODE: 'wisp-vim-learning-mode',

  OLLAMA_URL: 'wisp_ollama_url', // pi providers: local Ollama endpoint

  // Misc
  CUSTOM_TEMPLATES: 'wisp:custom-templates',
  CONTEXT_MENU_RULES: 'wisp:context-menu-rules',
  SAVED_SEARCHES: 'wisp:saved-searches',
  WORKSPACE_LAYOUTS: 'wisp:workspace-layouts',
  CLIPBOARD_HISTORY: 'wisp:clipboard-history',
  NOTIFICATION_HISTORY: 'wisp-notification-history',

  // Sync
  SYNC_API_URL: 'wisp-sync-api-url',
  SYNC_TOKEN: 'wisp-sync-token',
  AUTO_SYNC_ENABLED: 'wisp-auto-sync-enabled',

  // Google Drive
  PENDING_GDRIVE_TAB: 'wisp:pending-gdrive-tab',

  // File open preferences (Open With)
  FILE_OPEN_PREFS: 'wisp:file-open-prefs',




  // Agent launcher (external CLI agents)
  AGENT_LAUNCHER_LAST_TYPE: 'wisp:agent-launcher-last-type',
  AGENT_LAUNCHER_CUSTOM_COMMAND: 'wisp:agent-launcher-custom-command',

  // Extension auto-update




} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
