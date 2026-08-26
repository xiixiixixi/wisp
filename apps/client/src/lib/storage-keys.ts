/**
 * Centralized registry of all localStorage keys used by Wisp.
 * Always reference these constants instead of hardcoding key strings.
 */
export const STORAGE_KEYS = {
  // Core settings & UI
  SETTINGS: 'wisp:settings',
  UI_STATE: 'wisp:ui-state',
  FONT_SIZE: 'wisp:font-size',
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

  // Onboarding / tour
  TOUR_COMPLETED: 'wisp:tour-completed',
  BETA_WARNING_DISMISSED: 'wisp:beta-warning-dismissed',
  AUTO_WHITELIST_VISITED: 'wisp:auto-whitelist-visited',

  // Pane sync
  PANE_SYNC_ENABLED: 'wisp:pane-sync-enabled',
  PANE_SYNC_MODE: 'wisp:pane-sync-mode',

  // Vim mode
  VIM_MODE: 'wisp-vim-mode',
  VIM_LEARNING_MODE: 'wisp-vim-learning-mode',

  // AI / tokenizer
  OPENAI_KEY: 'wisp_openai_key',
  OLLAMA_URL: 'wisp_ollama_url',

  // Misc
  CUSTOM_TEMPLATES: 'wisp:custom-templates',
  CONTEXT_MENU_RULES: 'wisp:context-menu-rules',
  SAVED_SEARCHES: 'wisp:saved-searches',
  WORKSPACE_LAYOUTS: 'wisp:workspace-layouts',
  CLIPBOARD_HISTORY: 'wisp:clipboard-history',
  NOTIFICATION_HISTORY: 'wisp-notification-history',
  LAST_EXPORT_DATE: 'wisp:last-export-date',

  // Sync
  SYNC_API_URL: 'wisp-sync-api-url',
  SYNC_TOKEN: 'wisp-sync-token',
  AUTO_SYNC_ENABLED: 'wisp-auto-sync-enabled',

  // Google Drive
  PENDING_GDRIVE_TAB: 'wisp:pending-gdrive-tab',

  // File open preferences (Open With)
  FILE_OPEN_PREFS: 'wisp:file-open-prefs',

  // AI Chat file access
  AI_FILE_ACCESS_GRANTED: 'wisp:ai-file-access-granted',

  // AI Chat history
  AI_CHAT_HISTORY: 'wisp:ai-chat-history',

  // AI Chat action templates
  AI_ACTION_TEMPLATES: 'wisp:ai-action-templates',

  // AI Proactive agent
  PROACTIVE_AGENT_ENABLED: 'wisp:proactive-agent-enabled',

  // AI Agent memory
  AI_AGENT_MEMORY: 'wisp:ai-agent-memory',

  // AI Chat pinned messages
  AI_CHAT_PINNED: 'wisp:ai-chat-pinned',

  // AI Chat feedback (thumbs up/down)
  AI_CHAT_FEEDBACK: 'wisp:ai-chat-feedback',

  // AI Agent audit log
  AI_AUDIT_LOG: 'wisp:ai-audit-log',

  // AI Agent security rules
  AI_SECURITY_RULES: 'wisp:ai-security-rules',

  // AI Workflow templates
  AI_WORKFLOW_TEMPLATES: 'wisp:ai-workflow-templates',

  // AI Chat onboarding
  AI_ONBOARDING_DONE: 'wisp:ai-onboarding-done',

  // Agent launcher recent prompts
  AGENT_LAUNCHER_RECENT: 'wisp:agent-launcher-recent',

  // Extension auto-update
  AUTO_UPDATE_EXTENSIONS: 'wisp:auto-update-extensions',

  // Agent cost tracking (daily token/cost history)
  AGENT_COST_HISTORY: 'wisp:agent-cost-history',

  // Agent session history (completed sessions)
  AGENT_SESSION_HISTORY: 'wisp:agent-session-history',

  // Agent notification preferences (per-type enable/disable)
  AGENT_NOTIFICATION_PREFS: 'wisp:agent-notification-prefs',

  // Agent scheduled tasks
  AGENT_SCHEDULES: 'wisp:agent-schedules',
  AGENT_SCHEDULE_RUNS: 'wisp:agent-schedule-runs',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
