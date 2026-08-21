import { useCallback, useRef } from 'react';
import { startDrag } from '@crabnebula/tauri-plugin-drag';
import { resolveResource } from '@tauri-apps/api/path';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';
import { modifierDragOperation } from '@/lib/drag-utils';
import { useDragDropContext } from '@/contexts/DragDropContext';

interface UseDraggableOptions {
  file: FileEntry;
  selectedFiles: Set<string>;
  allFiles: FileEntry[];
}

const DRAG_THRESHOLD = 5; // pixels before drag starts

let _dragIconPath: string | null = null;
const getDragIconPath = async (): Promise<string> => {
  if (_dragIconPath) return _dragIconPath;
  try {
    _dragIconPath = await resolveResource('icons/icon.png');
  } catch {
    _dragIconPath = '';
  }
  return _dragIconPath;
};

// Finder-style drag ghost: use the dragged file's own system icon instead of
// the app icon. Cached per path across all rows.
const dragIconCache = new Map<string, string>();
const resolveDragIcon = async (path: string): Promise<string> => {
  const cached = dragIconCache.get(path);
  if (cached) return cached;
  let iconPath: string;
  try {
    iconPath = await TauriAPI.getFileIconPng(path);
  } catch {
    iconPath = await getDragIconPath();
  }
  dragIconCache.set(path, iconPath);
  return iconPath;
};

/**
 * Native drag hook using tauri-plugin-drag.
 * Uses mousedown/mousemove to detect drag intent, then calls startDrag()
 * which creates an OS-level drag operation (works for internal drops AND
 * dragging to desktop/other apps).
 */
export const useDraggable = ({ file, selectedFiles, allFiles }: UseDraggableOptions) => {
  const mouseDownRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const { startInternalDrag, endInternalDrag } = useDragDropContext();

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // only left button
    // Don't hijack existing text selections — starting a drag would abort them
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    mouseDownRef.current = { x: e.clientX, y: e.clientY };
    draggingRef.current = false;
  }, []);

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!mouseDownRef.current || draggingRef.current) return;

      const dx = e.clientX - mouseDownRef.current.x;
      const dy = e.clientY - mouseDownRef.current.y;
      if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;

      draggingRef.current = true;
      mouseDownRef.current = null;

      // Web mode has no native drag channel: without Tauri's drag events the
      // internal drag state could never be ended, so skip drags entirely and
      // surface a hint that drag & drop needs the desktop app.
      if (!isTauri()) {
        window.dispatchEvent(new CustomEvent('web-drag-attempt'));
        return;
      }

      // Determine which files to drag
      let pathsToDrag: string[];
      if (selectedFiles.has(file.path) && selectedFiles.size > 1) {
        pathsToDrag = allFiles.filter((f) => selectedFiles.has(f.path)).map((f) => f.path);
      } else {
        pathsToDrag = [file.path];
      }

      // ⌘+drag (without ⌥): drag the paths as plain text instead of files, so
      // terminals and plain-text editors receive the paths directly.
      // ⌘⌥+drag stays a file drag and becomes a symbolic link (INT-03).
      if (e.metaKey && !e.altKey) {
        resolveDragIcon(pathsToDrag[0]).then((icon) => {
          startDrag(
            {
              item: { data: pathsToDrag.join('\n'), types: ['public.utf8-plain-text'] },
              icon,
            },
            () => endInternalDrag(),
          ).catch((err) => {
            console.error('startDrag failed:', err);
            endInternalDrag();
          });
        });
        return;
      }

      // Notify context this is an internal drag. Modifiers already held when
      // the drag starts decide the initial operation (macOS habit: hold ⌥
      // first, then drag).
      startInternalDrag(pathsToDrag, modifierDragOperation(e.altKey, e.metaKey));

      // Start native Tauri drag — OS handles visuals + drop
      // When dropped back in our window, onDragDropEvent fires
      // When dropped on desktop/another app, OS handles it
      resolveDragIcon(pathsToDrag[0]).then((icon) => {
        startDrag({ item: pathsToDrag, icon }, () => endInternalDrag()).catch((err) => {
          console.error('startDrag failed:', err);
          endInternalDrag();
        });
      });
    },
    [file.path, selectedFiles, allFiles, startInternalDrag, endInternalDrag],
  );

  const onMouseUp = useCallback(() => {
    mouseDownRef.current = null;
    draggingRef.current = false;
  }, []);

  const onMouseLeave = useCallback(() => {
    // If mouse leaves the element before threshold, cancel tracking
    if (!draggingRef.current) {
      mouseDownRef.current = null;
    }
  }, []);

  return {
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave,
  };
};
