import { useState, useEffect } from 'react';
import { STORAGE_KEYS } from '@/lib/storage-keys';

const readFoldersFirst = (): boolean => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (raw) {
      const parsed = JSON.parse(raw) as { foldersFirst?: boolean };
      // Matches DEFAULT_SETTINGS.foldersFirst = true when absent.
      return parsed.foldersFirst !== false;
    }
  } catch {
    /* ignore localStorage/parse errors */
  }
  return true;
};

/**
 * The "folders on top" explorer setting, shared live across every pane via
 * localStorage + the 'wisp-settings-changed' event. On (the default) keeps
 * directories above files in list, grid, and column views; off gives the
 * active sort dimension a pure total order (Finder's list-view behavior).
 */
export const useFoldersFirst = (): boolean => {
  const [foldersFirst, setFoldersFirst] = useState<boolean>(readFoldersFirst);

  useEffect(() => {
    const syncFromSettings = () => setFoldersFirst(readFoldersFirst());
    window.addEventListener('wisp-settings-changed', syncFromSettings);
    return () => window.removeEventListener('wisp-settings-changed', syncFromSettings);
  }, []);

  return foldersFirst;
};
