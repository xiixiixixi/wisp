import { useCallback, useState, type FocusEvent } from 'react';
import type { FileEntry } from '@/lib/tauri-api';

/** Prefer the remembered row, but keep one entry among the rows actually mounted. */
export const resolveRenderedFileTabStop = (
  preferredPath: string | null | undefined,
  renderedFiles: readonly FileEntry[],
): string | undefined =>
  renderedFiles.some((file) => file.path === preferredPath)
    ? (preferredPath ?? undefined)
    : renderedFiles[0]?.path;

/** A file collection is one keyboard stop; arrows move within the collection. */
export const useFileTabStop = (
  files: FileEntry[],
  selectedFiles: Set<string>,
  renderedFiles: readonly FileEntry[] = files,
) => {
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const preferredPath =
    (files.some((file) => file.path === focusedPath) ? focusedPath : null) ??
    files.find((file) => selectedFiles.has(file.path))?.path ??
    files[0]?.path;
  const tabStopPath = resolveRenderedFileTabStop(preferredPath, renderedFiles);
  const rememberFileFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-file-path]');
    if (item && event.currentTarget.contains(item)) {
      setFocusedPath(item.dataset.filePath ?? null);
    }
  }, []);
  return { tabStopPath, rememberFileFocus };
};
