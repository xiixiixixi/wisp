import { useEffect, useRef } from 'react';
import { TauriAPI } from '@/lib/tauri-api';
import { dispatchFileContentChanged } from '@/lib/file-change-events';

interface DirectoryWatchOptions {
  path: string;
  enabled: boolean;
  onChange: () => void;
  onReconcile?: () => void;
  onDirectoryRemoved: () => void;
}

export function useDirectoryWatch({
  path,
  enabled,
  onChange,
  onReconcile,
  onDirectoryRemoved,
}: DirectoryWatchOptions) {
  const callbacks = useRef({ onChange, onReconcile, onDirectoryRemoved });
  callbacks.current = { onChange, onReconcile, onDirectoryRemoved };

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let watcherId: string | null = null;
    let unlisten: (() => void) | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let needsReconcile = false;
    const changedPaths = new Set<string>();

    const scheduleRefresh = (reconcile = false) => {
      if (disposed) return;
      needsReconcile ||= reconcile;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!disposed) {
          const reconcilePending = needsReconcile;
          needsReconcile = false;
          callbacks.current.onChange();
          if (reconcilePending) callbacks.current.onReconcile?.();
          changedPaths.forEach((changedPath) => dispatchFileContentChanged(changedPath));
          changedPaths.clear();
        }
      }, 400);
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) scheduleRefresh(true);
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    void (async () => {
      try {
        const stopListening = await TauriAPI.listenToEvent<{
          watcher_id: string;
          path: string;
          event_type: string;
        }>('fs-change', (event) => {
          if (disposed || !watcherId || event.watcher_id !== watcherId) return;
          if (event.event_type === 'file-deleted' && event.path === path) {
            callbacks.current.onDirectoryRemoved();
            return;
          }
          if (event.event_type !== 'file-deleted') changedPaths.add(event.path);
          scheduleRefresh();
        });
        if (disposed) {
          stopListening();
          return;
        }
        unlisten = stopListening;
        const id = await TauriAPI.watchDirectory(path, false);
        if (disposed) {
          void TauriAPI.unwatchDirectory(id).catch(() => undefined);
          return;
        }
        watcherId = id;
        // Reconcile writes between the initial directory read and watch setup.
        callbacks.current.onChange();
        callbacks.current.onReconcile?.();
      } catch (error) {
        unlisten?.();
        unlisten = undefined;
        if (!disposed) console.warn('[pane] Failed to watch directory:', error);
      }
    })();

    return () => {
      disposed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      unlisten?.();
      unlisten = undefined;
      if (watcherId) {
        void TauriAPI.unwatchDirectory(watcherId).catch(() => undefined);
      }
    };
  }, [enabled, path]);
}
