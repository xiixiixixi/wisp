import { TauriAPI, type FileEntry } from './tauri-api';
import { getDemoUserDirectories, isBrowserDemoMode } from './browser-demo-files';
import { findDemoEntry } from './demo-recent-store';

export type EntryActionIntent = 'open' | 'reveal';
export interface RecentEntryTarget {
  path: string;
  isDir?: boolean;
}

export const resolveEntryPath = async (path: string): Promise<string> => {
  if (path !== '~' && !path.startsWith('~/') && !path.startsWith('~\\')) return path;
  const directories = isBrowserDemoMode()
    ? getDemoUserDirectories()
    : await TauriAPI.getUserDirectories();
  if (path === '~') return directories.home;
  const sep = directories.home.includes('\\') ? '\\' : '/';
  return (
    directories.home.replace(/[/\\]+$/, '') +
    (path.length > 1 ? sep + path.slice(2).replace(/[/\\]/g, sep) : '')
  );
};

/** Filesystem paths only; virtual collections and remote services have separate history. */
export const isLocalEntryPath = (path: string): boolean =>
  path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path);

/** Keep POSIX, drive and UNC share roots intact; root entries reveal themselves. */
export const parentDirectory = (path: string): string => {
  const sep = path.includes('\\') ? '\\' : '/';
  const drive = /^[A-Za-z]:[/\\]/.test(path) ? path.slice(0, 3) : '';
  const unc = path.match(/^(?:\\\\|\/\/)[^/\\]+[/\\][^/\\]+/);
  const root = unc?.[0] || drive || (path.startsWith('/') ? '/' : '');
  let end = path.length;
  while (end > root.length && path[end - 1] === sep) end--;
  const normalized = path.slice(0, end);
  const index = normalized.lastIndexOf(sep);
  if (normalized.length <= root.length || index < root.length) return root || normalized;
  return normalized.slice(0, index);
};

/** History persistence must never turn an already successful open into an error. */
export const recordSuccessfulVisit = async (path: string): Promise<void> => {
  if (!isLocalEntryPath(path)) return;
  try {
    await TauriAPI.addRecentFile(path);
  } catch (error) {
    console.warn('Could not update recent visits:', error);
  }
};

export const openRecentEntry = async (
  entry: RecentEntryTarget,
  navigateToPath: (path: string) => void,
  options: { openDemoFile?: (file: FileEntry) => void | Promise<void> } = {},
): Promise<void> => {
  const path = await resolveEntryPath(entry.path);
  if (entry.isDir && /^[a-z][a-z\d+.-]*:\/\//i.test(path)) {
    navigateToPath(path);
    return;
  }
  if (isBrowserDemoMode()) {
    const file = findDemoEntry(path);
    if (!file) throw new Error(`Demo entry is unavailable: ${path}`);
    if (file.is_dir) navigateToPath(file.path);
    else if (options.openDemoFile) {
      await options.openDemoFile(file);
      await recordSuccessfulVisit(file.path);
    } else navigateToPath(parentDirectory(file.path));
    return;
  }
  const isDir = entry.isDir ?? (await TauriAPI.isDir(path));
  if (isDir) {
    // The pane records the visit after its directory read succeeds.
    navigateToPath(path);
    return;
  }
  await TauriAPI.openFile(path);
  await recordSuccessfulVisit(path);
};
