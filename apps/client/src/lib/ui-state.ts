import { STORAGE_KEYS } from '@/lib/storage-keys';

/**
 * Merge a partial patch into the shared `wisp:ui-state` localStorage object.
 * Used by both the explorer (layout/view/theme persistence) and the settings
 * page, so settings changes stay in sync with the runtime UI state.
 */
export const patchUiState = (patch: Record<string, unknown>): void => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.UI_STATE);
    const parsedRaw = raw ? JSON.parse(raw) : {};
    const existing = typeof parsedRaw === 'object' && parsedRaw !== null ? parsedRaw : {};
    localStorage.setItem(STORAGE_KEYS.UI_STATE, JSON.stringify({ ...existing, ...patch }));
  } catch (e) {
    console.warn('Failed to save UI state:', e);
  }
};

// ── Theme resolution ─────────────────────────────────────────────────────────

/** Theme used when no stored preference exists. */
export const DEFAULT_THEME = 'rolex';

/**
 * Older built-in themes that migrate to Wisp Ink when no choice was made.
 * Migration only happens when the user has never actively picked a theme
 * (see `markThemeChosen`), so a deliberate choice is always respected.
 */
const LEGACY_THEMES = new Set(['glass', 'light']);

/** Mark that the user actively chose a theme — disables legacy migration. */
export const markThemeChosen = (): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.THEME_CHOSEN, '1');
  } catch {
    /* ignore */
  }
};

const readStoredTheme = (key: string): string | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.theme === 'string') {
      return parsed.theme;
    }
  } catch {
    /* ignore */
  }
  return null;
};

/**
 * Single source of truth for the active theme. The explorer and the settings
 * page both use this so the applied theme and the settings dropdown can never
 * disagree. Prefers `wisp:ui-state` (runtime state), falls back to
 * `wisp:settings`, then the default Wisp Ink theme.
 */
export const resolveTheme = (): string => {
  const chosen = (() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.THEME_CHOSEN) === '1';
    } catch {
      return false;
    }
  })();
  const migrate = (theme: string): string =>
    !chosen && LEGACY_THEMES.has(theme) ? DEFAULT_THEME : theme;

  const uiTheme = readStoredTheme(STORAGE_KEYS.UI_STATE);
  if (uiTheme) return migrate(uiTheme);

  const settingsTheme = readStoredTheme(STORAGE_KEYS.SETTINGS);
  if (settingsTheme) return migrate(settingsTheme);

  return DEFAULT_THEME;
};
