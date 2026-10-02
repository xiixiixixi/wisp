import { isTauri } from '@/lib/transport';

export const FILES_CHANGED_EVENT = 'files-changed';
export const FILE_CONTENT_CHANGED_EVENT = 'wisp-file-content-changed';
const GLOBAL_FILES_CHANGED_EVENT = 'wisp-files-changed';
const windowSourceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const pendingContentChanges = new Set<string>();
let contentChangeTimer: ReturnType<typeof setTimeout> | null = null;

interface GlobalFilesChangedPayload {
  source: string;
}

/** Refresh every file pane in the current Wisp window. */
export const dispatchLocalFilesChanged = () => {
  window.dispatchEvent(new CustomEvent(FILES_CHANGED_EVENT));
};

/** Refresh content even when size and whole-second timestamps are unchanged. */
export const dispatchFileContentChanged = (path: string) => {
  pendingContentChanges.add(path);
  if (contentChangeTimer !== null) return;

  contentChangeTimer = setTimeout(() => {
    contentChangeTimer = null;
    // Snapshot first so listeners can safely queue changes for the next batch.
    const paths = [...pendingContentChanges];
    pendingContentChanges.clear();
    for (const changedPath of paths) {
      window.dispatchEvent(
        new CustomEvent(FILE_CONTENT_CHANGED_EVENT, { detail: { path: changedPath } }),
      );
    }
  }, 250);
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
