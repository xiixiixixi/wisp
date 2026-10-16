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

const writeShowHidden = (next: boolean): void => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed.showHiddenFiles = next;
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(parsed));
  } catch {
    /* storage full or unavailable */
  }
};

/**
 * Read the persisted hidden-file visibility without a React hook — used by the
 * context-menu factory, which builds menus outside the component tree.
 */
export const readHiddenFilesVisible = (): boolean => readShowHidden();

/**
 * Toggle the persisted hidden-file visibility and broadcast the change so every
 * pane (and the ⌘⇧. shortcut) stays in sync. Safe to call from menu actions.
 */
export const toggleHiddenFilesState = (): void => {
  const next = !readShowHidden();
  writeShowHidden(next);
  window.dispatchEvent(new CustomEvent('wisp-settings-changed'));
};

/**
 * Hidden-file visibility (Finder's ⌘⇧.). Shared by the title bar and every pane
 * via localStorage + the 'wisp-settings-changed' event, so toolbar clicks and
 * keyboard shortcuts stay in sync across split panes.
 */
export const useHiddenFiles = () => {
  const [showHiddenFiles, setShowHiddenFiles] = useState<boolean>(readShowHidden);

  useEffect(() => {
    const syncFromSettings = () => setShowHiddenFiles(readShowHidden());
    window.addEventListener('wisp-settings-changed', syncFromSettings);
    return () => window.removeEventListener('wisp-settings-changed', syncFromSettings);
  }, []);

  const toggleHiddenFiles = useCallback(() => {
    toggleHiddenFilesState();
    setShowHiddenFiles(readShowHidden());
  }, []);

  return { showHiddenFiles, toggleHiddenFiles };
};
