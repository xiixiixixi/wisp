import { useCallback, useRef } from 'react';
import { caretOffsetAtPoint, RENAME_DOUBLE_CLICK_MS } from '@/lib/label-rename';

/**
 * Finder's "click the name of the selected item to rename" behavior, shared by
 * every file view (details / grid / column / tree).
 *
 * - The first click anywhere on the row selects it (the row's own handler).
 * - A later click that lands on the name text itself starts an inline rename
 *   through `onStart` — the same channel the Enter key uses.
 * - A fast second click is the tail of a double-click and keeps opening the
 *   item, so `noteRowClick` must be called from the row's click handler.
 * - Dragging an item by its label never starts a rename (the pointer must
 *   barely move between pointerdown and click).
 */
export const useLabelRename = (
  isSelected: boolean,
  onStart: (caretOffset: number | undefined) => void,
) => {
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastRowClickAtRef = useRef(0);

  /** Records a click on the row so the gap to the next name click can tell a
   *  double-click apart from a slow rename click. Wire into the row's onClick. */
  const noteRowClick = useCallback(() => {
    lastRowClickAtRef.current = Date.now();
  }, []);

  const onLabelPointerDown = useCallback((e: React.PointerEvent) => {
    pressStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onLabelClick = useCallback(
    (e: React.MouseEvent<HTMLSpanElement>) => {
      const start = pressStartRef.current;
      pressStartRef.current = null;
      if (!start || !isSelected) return;
      // Dragging the item by its label must keep working.
      const moved = Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y);
      if (moved > 4) return;
      // The tail of a fast double-click opens the file (Finder); only a slow
      // re-click of the already-selected name starts the rename.
      if (Date.now() - lastRowClickAtRef.current < RENAME_DOUBLE_CLICK_MS) return;
      e.stopPropagation();
      // Finder places the edit caret exactly where the name was clicked.
      onStart(caretOffsetAtPoint(e.currentTarget, e.clientX, e.clientY));
    },
    [isSelected, onStart],
  );

  return { onLabelPointerDown, onLabelClick, noteRowClick };
};
