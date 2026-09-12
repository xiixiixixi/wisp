import { useCallback, useEffect, type RefObject } from 'react';
import type { FileEntry } from '@/lib/tauri-api';
import { FILE_NAVIGATION_EVENT, type FileNavigationRequest } from '@/lib/file-navigation';

interface UseGridKeyboardNavOptions {
  files: FileEntry[];
  selectedFiles: Set<string>;
  columns: number;
  viewMode: string;
  getColumnsCount: () => number;
  handleFileClick: (file: FileEntry, event: React.MouseEvent) => void;
  handleFileDoubleClick: (file: FileEntry) => void;
  needsVirtualization: boolean;
  virtualizer: { scrollToIndex: (index: number, options?: Record<string, unknown>) => void };
  /** Called when Space is pressed on a focused file to show Quick Look. */
  onQuickLook?: (file: FileEntry) => void;
  containerRef?: RefObject<HTMLDivElement | null>;
}

/**
 * Keyboard navigation for the file grid.
 *
 * Arrow keys move focus and update selection.
 * Shift+Arrow extends the selection range.
 * Home/End jump to first/last item.
 * Enter renames the focused item.
 * Space opens Quick Look preview for the focused item.
 */
export const useGridKeyboardNav = ({
  files,
  selectedFiles,
  columns,
  viewMode,
  getColumnsCount,
  handleFileClick,
  needsVirtualization,
  virtualizer,
  onQuickLook,
  containerRef,
}: UseGridKeyboardNavOptions) => {
  const selectIndex = useCallback(
    (index: number, container: HTMLDivElement, shiftKey = false, focus = true) => {
      const file = files[index];
      if (!file) return null;
      handleFileClick(file, { shiftKey, ctrlKey: false, metaKey: false } as React.MouseEvent);
      if (needsVirtualization) {
        virtualizer.scrollToIndex(Math.floor(index / columns), { align: 'auto' });
      }
      requestAnimationFrame(() => {
        // Look up by path after virtual rows have mounted, never by the index
        // within the (potentially partial) set of mounted DOM items.
        const target = container.querySelector<HTMLElement>(
          `[data-file-path="${CSS.escape(file.path)}"]`,
        );
        if (target) {
          if (focus) target.focus({ preventScroll: true });
          target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      });
      return file;
    },
    [files, handleFileClick, needsVirtualization, virtualizer, columns],
  );

  useEffect(() => {
    const handleRequest = (event: Event) => {
      if (event.defaultPrevented) return;
      const container = containerRef?.current;
      if (!container || container.closest('[data-active="false"]')) return;
      const request = event as CustomEvent<FileNavigationRequest>;
      const index = files.findIndex((file) => file.path === request.detail.path);
      if (index < 0) return;
      event.preventDefault();
      const next = Math.max(0, Math.min(files.length - 1, index + request.detail.direction));
      request.detail.file = selectIndex(next, container, false, false);
    };
    window.addEventListener(FILE_NAVIGATION_EVENT, handleRequest);
    return () => window.removeEventListener(FILE_NAVIGATION_EVENT, handleRequest);
  }, [files, containerRef, selectIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Don't intercept when an input or textarea is focused
      const active = document.activeElement;
      if (e.defaultPrevented || e.nativeEvent?.isComposing) return;
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.tagName === 'SELECT' ||
          (active as HTMLElement).isContentEditable)
      ) {
        return;
      }

      const navKeys = [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'Enter',
        ' ',
      ];
      if (!navKeys.includes(e.key)) return;
      // Leave modified combos (⌘↓ open, ⌘↑ go up, …) to the global shortcut system
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (files.length === 0) return;
      e.preventDefault();

      const container = e.currentTarget;

      // Find currently focused item index
      const focusedEl = (active as HTMLElement)?.closest?.('[data-file-path]');
      const focusedPath = focusedEl?.getAttribute('data-file-path');
      let currentIndex = files.findIndex((file) => file.path === focusedPath);

      // If nothing is focused, start from the first selected item or 0
      if (currentIndex === -1) {
        if (selectedFiles.size > 0) {
          const firstSelected = files.findIndex((f) => selectedFiles.has(f.path));
          currentIndex = firstSelected >= 0 ? firstSelected : 0;
        } else {
          currentIndex = 0;
        }
      }

      // Handle Enter — rename the focused item (Finder behaviour; open with ⌘O/⌘↓)
      if (e.key === 'Enter') {
        const file = files[currentIndex];
        if (file) {
          e.stopPropagation();
          window.dispatchEvent(
            new CustomEvent('start-inline-rename', { detail: { path: file.path } }),
          );
        }
        return;
      }

      // Handle Space — Quick Look preview of focused file. Consume the event
      // so the document-level shortcut system doesn't fire a second time.
      if (e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        const file = files[currentIndex];
        if (file && onQuickLook) {
          onQuickLook(file);
        }
        return;
      }

      // Arrow / Home / End navigation
      const cols = ['list', 'details', 'column', 'gallery', 'tree'].includes(viewMode)
        ? 1
        : getColumnsCount();
      let nextIndex = currentIndex;

      switch (e.key) {
        case 'ArrowRight':
          nextIndex = Math.min(currentIndex + 1, files.length - 1);
          break;
        case 'ArrowLeft':
          nextIndex = Math.max(currentIndex - 1, 0);
          break;
        case 'ArrowDown':
          nextIndex = Math.min(currentIndex + cols, files.length - 1);
          break;
        case 'ArrowUp':
          nextIndex = Math.max(currentIndex - cols, 0);
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = files.length - 1;
          break;
      }

      if (nextIndex === currentIndex && e.key !== 'Home' && e.key !== 'End') return;

      e.stopPropagation();
      selectIndex(nextIndex, container, e.shiftKey);
    },
    [files, selectedFiles, viewMode, getColumnsCount, selectIndex, onQuickLook],
  );

  return { handleKeyDown };
};
