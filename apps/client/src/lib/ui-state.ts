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
export const DEFAULT_THEME = 'auto';

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
 * disagree. Historical stored keys are intentionally collapsed into Wisp's
 * single stable appearance.
 */
export const resolveTheme = (): string => {
  const uiTheme = readStoredTheme(STORAGE_KEYS.UI_STATE);
  if (uiTheme) return DEFAULT_THEME;

  const settingsTheme = readStoredTheme(STORAGE_KEYS.SETTINGS);
  if (settingsTheme) return DEFAULT_THEME;

  return DEFAULT_THEME;
};
