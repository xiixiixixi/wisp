import type { FileEntry } from '@/lib/tauri-api';

export const FILE_NAVIGATION_EVENT = 'wisp-navigate-adjacent-file';

export interface FileNavigationRequest {
  path: string;
  direction: -1 | 1;
  file: FileEntry | null;
}

/** Ask the active file view, which owns the visible order, to select a neighbour. */
export const requestAdjacentFile = (path: string, direction: -1 | 1): FileEntry | null => {
  const detail: FileNavigationRequest = { path, direction, file: null };
  window.dispatchEvent(new CustomEvent(FILE_NAVIGATION_EVENT, { detail, cancelable: true }));
  return detail.file;
};
