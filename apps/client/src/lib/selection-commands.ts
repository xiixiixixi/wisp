import type { FileEntry } from '@/lib/tauri-api';
import type { ContextMenuAction } from '@/lib/context-menu-factory';

/** One selection contract for keyboard commands and contextual actions. */
export const selectionCommands = (
  selectedPaths: Set<string>,
  files: FileEntry[],
  actions: ContextMenuAction,
  openSingle: (file: FileEntry) => void,
) => {
  const entries = files.filter((file) => selectedPaths.has(file.path));
  return {
    properties: () => {
      if (entries.length) return actions.properties(entries.length === 1 ? entries[0] : entries);
    },
    copyPath: () => {
      // Copy is path-only: never drop a selected path while a list refreshes.
      const byPath = new Map(files.map((file) => [file.path, file]));
      const targets = Array.from(
        selectedPaths,
        (path) =>
          byPath.get(path) ?? {
            path,
            name: path.split(/[/\\]/).pop() || path,
            is_dir: false,
            is_readonly: false,
            size: 0,
            modified: 0,
            file_type: '',
          },
      );
      if (targets.length) return actions.copyPath(targets);
    },
    duplicate: () => {
      if (entries.length) return actions.duplicateFiles(entries);
    },
    open: () => {
      if (entries.length === 1) return openSingle(entries[0]);
      // Navigating several folders in one pane would leave only the last one.
      for (const file of entries) {
        if (file.is_dir) actions.openInNewTab(file);
        else actions.openFile(file);
      }
    },
    rename: () => {
      if (entries.length > 1) return actions.bulkRename(entries);
      if (entries.length === 1) {
        window.dispatchEvent(
          new CustomEvent('start-inline-rename', {
            detail: { path: entries[0].path },
          }),
        );
      }
    },
  };
};
