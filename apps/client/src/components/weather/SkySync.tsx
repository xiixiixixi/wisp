import { useEffect } from 'react';
import { migrateRetiredSettings } from '@/lib/retired-settings';
import { useWindowMaterial } from '@/hooks/use-window-material';
import { applyAppearance, readAppearancePreference } from '@/lib/appearance';
import { STORAGE_KEYS } from '@/lib/storage-keys';

/** Keep the selected appearance current. Material accessibility is handled by CSS. */
const SkySync = () => {
  useWindowMaterial();
  useEffect(() => {
    const appearance = window.matchMedia('(prefers-color-scheme: dark)');
    const applyDefaults = () => {
      migrateRetiredSettings();
      const root = document.documentElement;
      root.classList.remove(
        'theme-glass',
        'font-small',
        'font-semibold',
        'font-large',
        'font-xl',
        'reduce-motion',
        'reduce-transparency',
        'enhanced-focus',
        'high-contrast',
      );
      applyAppearance(readAppearancePreference(), appearance.matches);
      delete root.dataset.sky;
    };
    const syncFromStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.SETTINGS || event.key === null) applyDefaults();
    };
    applyDefaults();
    window.addEventListener('wisp-settings-changed', applyDefaults);
    window.addEventListener('storage', syncFromStorage);
    appearance.addEventListener('change', applyDefaults);
    return () => {
      window.removeEventListener('wisp-settings-changed', applyDefaults);
      window.removeEventListener('storage', syncFromStorage);
      appearance.removeEventListener('change', applyDefaults);
    };
  }, []);
  return null;
};
export default SkySync;
