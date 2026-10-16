import { useCallback, useRef } from 'react';
import { useWindowEvent } from '@/hooks/use-window-event';

export interface SpringLoadedFolderDetail {
  path: string;
  groupId?: string;
}

export const springLoadedFolderDetail = (
  target: HTMLElement,
  path: string,
): SpringLoadedFolderDetail => ({
  path,
  groupId: target.closest('[data-group-id]')?.getAttribute('data-group-id') ?? undefined,
});

export const isLiveSpringLoadTarget = (
  isDragging: boolean,
  isOverWindow: boolean,
  original: { element: HTMLElement; path: string },
  live: { element: HTMLElement; path: string } | null,
): live is { element: HTMLElement; path: string } =>
  isDragging &&
  isOverWindow &&
  original.element.isConnected &&
  live?.element === original.element &&
  live.path === original.path;

/** Route a drag-hovered folder to the pane containing the drop target. */
export const useSpringLoadedFolder = (
  groupId: string,
  currentPath: string,
  onNavigate: (groupId: string, path: string, name: string) => void,
) => {
  const pendingPathRef = useRef<string | null>(null);
  useWindowEvent(
    'spring-load-folder',
    (event: Event) => {
      const detail = (event as CustomEvent<SpringLoadedFolderDetail>).detail;
      if (!detail?.path || detail.groupId !== groupId || detail.path === currentPath) return;
      pendingPathRef.current = detail.path;
      onNavigate(groupId, detail.path, detail.path.split(/[/\\]/).pop() || detail.path);
    },
    [groupId, currentPath, onNavigate],
  );

  // The pane's next navigation effect consumes this once so dragging into a
  // target folder does not mirror that navigation to a synchronized pane.
  return useCallback((path: string): boolean => {
    const wasSpringLoad = pendingPathRef.current === path;
    pendingPathRef.current = null;
    return wasSpringLoad;
  }, []);
};
