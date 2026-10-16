/**
 * Preview action surface (#22).
 *
 * Finder trims the preview's action bar to what the selected item supports
 * (images get rotate, folders get none of it). The bar itself is type-driven:
 * `getPreviewActionsForFile` decides which actions exist, and the rotate
 * display-state travels over a window event so the header buttons can drive
 * the lazily loaded preview body without threading props through it.
 */
import type { FileEntry } from '@/lib/tauri-api';
import { getFileKindBucket } from '@/lib/kind-groups';

/** Window event carrying a display-state rotation request for one file. */
export const PREVIEW_ROTATE_EVENT = 'wisp-preview-rotate';

export interface PreviewRotateDetail {
  path: string;
  delta: number;
}

export const dispatchPreviewRotate = (path: string, delta = 90): void => {
  window.dispatchEvent(
    new CustomEvent<PreviewRotateDetail>(PREVIEW_ROTATE_EVENT, { detail: { path, delta } }),
  );
};

export const addPreviewRotateListener = (
  handler: (detail: PreviewRotateDetail) => void,
): (() => void) => {
  const listener = (event: Event) => handler((event as CustomEvent<PreviewRotateDetail>).detail);
  window.addEventListener(PREVIEW_ROTATE_EVENT, listener);
  return () => window.removeEventListener(PREVIEW_ROTATE_EVENT, listener);
};

export type PreviewActionId = 'rotate' | 'calculate-size';

/**
 * Type-driven action list — the slot future preview kinds plug into. Images
 * rotate (display state only); folders offer Finder's deferred size
 * calculation; everything else renders no bar at all.
 */
export const getPreviewActionsForFile = (file: FileEntry | null): PreviewActionId[] => {
  if (!file) return [];
  if (file.is_dir) return ['calculate-size'];
  if (getFileKindBucket(file) === 'images') return ['rotate'];
  return [];
};
