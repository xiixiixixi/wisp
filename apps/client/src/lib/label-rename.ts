/**
 * Finder's label-click rename, shared by every file view.
 *
 * Clicking the name text of an already-selected item starts an inline rename
 * through the same channel the Enter key uses; the whole rest of the row only
 * selects. These helpers are the view-agnostic primitives — the wiring lives
 * in `useLabelRename`.
 */

/**
 * Map a click position onto the label's text and return the character offset
 * the caret should land on — Finder's label-click rename places the caret
 * exactly where the name was clicked. Falls back to undefined when the
 * point does not resolve onto the label's text node.
 */
export const caretOffsetAtPoint = (
  label: HTMLElement,
  x: number,
  y: number,
): number | undefined => {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset: number | undefined;
  if (doc.caretRangeFromPoint) {
    // WebKit / Blink
    const range = doc.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  } else if (doc.caretPositionFromPoint) {
    // Firefox
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || !label.contains(node)) return undefined;
  return offset;
};

/**
 * Clicks closer together than this are the tail of a double-click that must
 * keep opening the item; a slower re-click of the name starts the rename.
 * Matches the fast/slow boundary the grid has always used.
 */
export const RENAME_DOUBLE_CLICK_MS = 400;
