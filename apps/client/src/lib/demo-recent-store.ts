import { getDemoDirectory, getDemoRecentFiles, getDemoSearchFiles } from './browser-demo-files';
import type { FileEntry, RecentFile } from './tauri-api-types';

let records: RecentFile[] | undefined;
const history = () => (records ??= getDemoRecentFiles());

export const findDemoEntry = (path: string): FileEntry | undefined =>
  getDemoSearchFiles('').find((file) => file.path === path) ??
  (getDemoDirectory(path)
    ? {
        path,
        name: path.split('/').filter(Boolean).pop() || path,
        is_dir: true,
        size: 0,
        modified: 0,
        file_type: 'folder',
        is_readonly: false,
      }
    : undefined);

export const readDemoRecentFiles = (limit?: number): RecentFile[] =>
  history()
    .slice(0, limit ?? 100)
    .map((entry) => ({ ...entry }));

export const recordDemoRecentFile = (path: string): void => {
  const file = findDemoEntry(path);
  if (!file) throw new Error(`Demo entry is unavailable: ${path}`);
  records = [
    {
      path,
      name: file.name,
      file_type: file.is_dir ? 'folder' : file.file_type,
      size: file.size,
      accessed_at: Date.now(),
    },
    ...history().filter((entry) => entry.path !== path),
  ].slice(0, 100);
};

export const removeDemoRecentFile = (path: string): void => {
  records = history().filter((entry) => entry.path !== path);
};

export const clearDemoRecentFiles = (): void => {
  records = [];
};
