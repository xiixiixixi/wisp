import { useState, useEffect, useCallback } from 'react';
import { STORAGE_KEYS } from '@/lib/storage-keys';

const readShowHidden = (): boolean => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (raw) {
      return Boolean((JSON.parse(raw) as { showHiddenFiles?: boolean }).showHiddenFiles);
    }
  } catch {
    /* ignore localStorage/parse errors */
  }
  return false;
};

/**
 * Hidden-file visibility (Finder's ⌘⇧.). Shared with the settings page via
 * localStorage + the 'wisp-settings-changed' event so every pane — including
 * split panes — stays in sync with the ⇧⌘. toggle.
 */
export const useHiddenFiles = () => {
  const [showHiddenFiles, setShowHiddenFiles] = useState<boolean>(readShowHidden);

  useEffect(() => {
    const syncFromSettings = () => setShowHiddenFiles(readShowHidden());
    window.addEventListener('wisp-settings-changed', syncFromSettings);
    return () => window.removeEventListener('wisp-settings-changed', syncFromSettings);
  }, []);

  const toggleHiddenFiles = useCallback(() => {
    const next = !readShowHidden();
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      const parsed = raw ? JSON.parse(raw) : {};
      parsed.showHiddenFiles = next;
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(parsed));
    } catch {
      /* ignore localStorage/parse errors */
    }
    setShowHiddenFiles(next);
    window.dispatchEvent(new CustomEvent('wisp-settings-changed'));
  }, []);

  return { showHiddenFiles, toggleHiddenFiles };
};
