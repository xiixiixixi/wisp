import { useCallback, useEffect, useRef } from 'react';
import type { FileEntry } from '@/lib/tauri-api';

interface UseFileSelectionOptions {
  files: FileEntry[];
  currentPath: string;
  selectedFiles: Set<string>;
  setSelectedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelectedFile: React.Dispatch<React.SetStateAction<FileEntry | null>>;
}

type SelectionModifiers = Pick<React.MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>;

export const useFileSelection = ({
  files,
  currentPath,
  selectedFiles,
  setSelectedFiles,
  setSelectedFile,
}: UseFileSelectionOptions) => {
  const anchorRef = useRef<{ directory: string; path: string } | null>(null);

  // A deselected or previous-directory file is no longer a valid anchor.
  // Membership is checked against the clicked view below: tree rows and
  // child columns can include files outside the pane's root directory list.
  useEffect(() => {
    const anchor = anchorRef.current;
    if (anchor && (anchor.directory !== currentPath || !selectedFiles.has(anchor.path))) {
      anchorRef.current = null;
    }
  }, [currentPath, selectedFiles]);

  const handleFileClick = useCallback(
    (file: FileEntry, event?: SelectionModifiers, visibleFiles = files) => {
      setSelectedFile(file);
      const clickedIndex = visibleFiles.findIndex((entry) => entry.path === file.path);
      const anchor = anchorRef.current;
      const anchorIndex =
        anchor?.directory === currentPath && selectedFiles.has(anchor.path)
          ? visibleFiles.findIndex((entry) => entry.path === anchor.path)
          : -1;

      if (event?.shiftKey && anchorIndex >= 0 && clickedIndex >= 0) {
        const start = Math.min(anchorIndex, clickedIndex);
        const end = Math.max(anchorIndex, clickedIndex);
        const rangePaths = visibleFiles.slice(start, end + 1).map((entry) => entry.path);
        if (event.ctrlKey || event.metaKey) {
          setSelectedFiles((previous) => new Set([...previous, ...rangePaths]));
        } else {
          setSelectedFiles(new Set(rangePaths));
        }
        return;
      }
      if (event && (event.ctrlKey || event.metaKey)) {
        if (!selectedFiles.has(file.path)) {
          anchorRef.current = { directory: currentPath, path: file.path };
        } else if (anchor?.path === file.path) {
          anchorRef.current = null;
        }
        setSelectedFiles((previous) => {
          const next = new Set(previous);
          if (next.has(file.path)) next.delete(file.path);
          else next.add(file.path);
          return next;
        });
        return;
      }
      anchorRef.current = { directory: currentPath, path: file.path };
      setSelectedFiles(new Set([file.path]));
    },
    [currentPath, files, selectedFiles, setSelectedFiles, setSelectedFile],
  );

  return { handleFileClick };
};
