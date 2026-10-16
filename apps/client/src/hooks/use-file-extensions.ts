import { useState, useEffect } from 'react';
import { STORAGE_KEYS } from '@/lib/storage-keys';

const readShowExtensions = (): boolean => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (raw) {
      const parsed = JSON.parse(raw) as { showFileExtensions?: boolean };
      // Matches DEFAULT_SETTINGS.showFileExtensions = true when absent.
      return parsed.showFileExtensions !== false;
    }
  } catch {
    /* ignore localStorage/parse errors */
  }
  return true;
};

/**
 * The "show file extensions" explorer setting, shared live across every view
 * via localStorage + the 'wisp-settings-changed' event, so the settings-page
 * toggle takes effect without a remount.
 */
export const useFileExtensions = (): boolean => {
  const [showFileExtensions, setShowFileExtensions] = useState<boolean>(readShowExtensions);

  useEffect(() => {
    const syncFromSettings = () => setShowFileExtensions(readShowExtensions());
    window.addEventListener('wisp-settings-changed', syncFromSettings);
    return () => window.removeEventListener('wisp-settings-changed', syncFromSettings);
  }, []);

  return showFileExtensions;
};
