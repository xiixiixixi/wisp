import { STORAGE_KEYS } from '@/lib/storage-keys';

/**
 * One-time migration to the details-list default view.
 *
 * Earlier builds booted the explorer with a 'medium' icon-grid fallback (and
 * a 'grid' settings default that matched no dropdown option). Those defaults
 * were auto-persisted into `wisp:ui-state`, `wisp:settings`, and per-folder
 * entries in `wisp:folder-settings` without the user ever picking a view.
 *
 * This migration rewrites those stored old defaults to 'details'. Values that
 * differ from the old defaults were deliberately chosen and stay untouched.
 * Runs at most once, guarded by `wisp:view-default-migrated`.
 */
export const DEFAULT_VIEW = 'details';

const LEGACY_DEFAULT_VIEWS = new Set(['medium', 'grid']);

const readJson = (key: string): Record<string, unknown> => {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

const writeJson = (key: string, value: Record<string, unknown>): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
};

export const migrateLegacyDefaultView = (): void => {
  try {
    if (localStorage.getItem(STORAGE_KEYS.VIEW_DEFAULT_MIGRATED) === '1') return;
    localStorage.setItem(STORAGE_KEYS.VIEW_DEFAULT_MIGRATED, '1');
  } catch {
    return;
  }

  // Global explorer view (wisp:ui-state.viewMode)
  const uiState = readJson(STORAGE_KEYS.UI_STATE);
  if (typeof uiState.viewMode === 'string' && LEGACY_DEFAULT_VIEWS.has(uiState.viewMode)) {
    writeJson(STORAGE_KEYS.UI_STATE, { ...uiState, viewMode: DEFAULT_VIEW });
  }

  // Settings default-view dropdown value (wisp:settings.defaultView)
  const settings = readJson(STORAGE_KEYS.SETTINGS);
  if (typeof settings.defaultView === 'string' && LEGACY_DEFAULT_VIEWS.has(settings.defaultView)) {
    writeJson(STORAGE_KEYS.SETTINGS, { ...settings, defaultView: DEFAULT_VIEW });
  }

  // Per-folder auto-persisted view modes (wisp:folder-settings)
  const folderSettings = readJson(STORAGE_KEYS.FOLDER_SETTINGS);
  let folderChanged = false;
  for (const entry of Object.values(folderSettings)) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { viewMode?: unknown }).viewMode === 'string' &&
      LEGACY_DEFAULT_VIEWS.has((entry as { viewMode: string }).viewMode)
    ) {
      (entry as { viewMode: string }).viewMode = DEFAULT_VIEW;
      folderChanged = true;
    }
  }
  if (folderChanged) {
    writeJson(STORAGE_KEYS.FOLDER_SETTINGS, folderSettings);
  }
};
