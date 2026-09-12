import { STORAGE_KEYS } from '@/lib/storage-keys';
import { syncNativeAppearance } from '@/lib/native-appearance';

export type AppearancePreference = 'system' | 'light' | 'dark';

/** Legacy theme names never become appearance overrides. */
export const normalizeAppearance = (value: unknown): AppearancePreference =>
  value === 'light' || value === 'dark' ? value : 'system';

export const readAppearancePreference = (): AppearancePreference => {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    return normalizeAppearance(saved ? JSON.parse(saved)?.appearance : undefined);
  } catch {
    return 'system';
  }
};

/** Shared by the root synchronizer and the standalone Settings page. */
export const applyAppearance = (
  preference: AppearancePreference = readAppearancePreference(),
  systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches,
): void => {
  const dark = preference === 'dark' || (preference === 'system' && systemDark);
  const root = document.documentElement;
  root.dataset.wispAppearance = preference;
  root.classList.toggle('theme-rolex', dark);
  root.classList.toggle('theme-light', !dark);
  root.classList.add('theme-fluid');
  void syncNativeAppearance(preference);
};
