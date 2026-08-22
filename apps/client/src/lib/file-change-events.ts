import { isTauri } from '@/lib/transport';

export const FILES_CHANGED_EVENT = 'files-changed';
const GLOBAL_FILES_CHANGED_EVENT = 'wisp-files-changed';
const windowSourceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

interface GlobalFilesChangedPayload {
  source: string;
}

/** Refresh every file pane in the current Wisp window. */
export const dispatchLocalFilesChanged = () => {
  window.dispatchEvent(new CustomEvent(FILES_CHANGED_EVENT));
};

/**
 * Refresh this window immediately, then notify the other Wisp windows.
 * The source id prevents the sending window from processing its own broadcast twice.
 */
export const notifyFilesChanged = async (): Promise<void> => {
  dispatchLocalFilesChanged();
  if (!isTauri()) return;

  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(GLOBAL_FILES_CHANGED_EVENT, { source: windowSourceId });
  } catch (error) {
    // Local refresh already happened. A broadcast failure must not make a
    // successful file operation look like it failed.
    console.warn('Failed to notify other Wisp windows about file changes:', error);
  }
};

/** Forward file-change broadcasts from other Wisp windows into this window. */
export const listenForGlobalFileChanges = async (): Promise<() => void> => {
  if (!isTauri()) return () => {};

  const { listen } = await import('@tauri-apps/api/event');
  return listen<GlobalFilesChangedPayload>(GLOBAL_FILES_CHANGED_EVENT, (event) => {
    if (event.payload?.source === windowSourceId) return;
    dispatchLocalFilesChanged();
  });
};
