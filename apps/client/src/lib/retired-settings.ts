import { STORAGE_KEYS } from './storage-keys';

// Do not leave removed controls active as invisible overrides after an upgrade
// or after importing an older settings backup.
const RETIRED_SETTINGS = [
  'fontSize',
  'sidebarWidth',
  'enableAnimations',
  'enableNotifications',
  'autoSave',
  'enableMarkdownPreview',
  'reducedMotion',
  'reduceTransparency',
  'enhancedFocus',
  'highContrast',
  'fluidGlass',
  'weatherSync',
] as const;

export const stripRetiredSettings = <T extends object>(settings: T): T => {
  const next = { ...settings };
  for (const key of RETIRED_SETTINGS) delete (next as Record<string, unknown>)[key];
  return next;
};

export const migrateRetiredSettings = (): void => {
  try {
    localStorage.removeItem('wisp:font-size');
    localStorage.removeItem('wisp:auto-update-extensions');
    localStorage.removeItem('wisp:last-export-date');
    const rawRules = localStorage.getItem(STORAGE_KEYS.CONTEXT_MENU_RULES);
    if (rawRules) {
      const rules: unknown = JSON.parse(rawRules);
      if (Array.isArray(rules)) {
        const retained = rules.filter((rule) => rule?.menuItemId !== 'version-history');
        if (retained.length !== rules.length) {
          localStorage.setItem(STORAGE_KEYS.CONTEXT_MENU_RULES, JSON.stringify(retained));
        }
      }
    }
  } catch {
    // Keep malformed rules recoverable and continue migrating other settings.
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return;
    const settings: unknown = JSON.parse(raw);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
    const cleaned = JSON.stringify(stripRetiredSettings(settings));
    if (cleaned !== raw) localStorage.setItem(STORAGE_KEYS.SETTINGS, cleaned);
  } catch {
    // Storage can be unavailable. Fixed appearance must still be applied.
  }
};
