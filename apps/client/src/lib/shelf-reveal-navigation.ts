import type { Shelves } from '@wisp/sdk';
import type { EditorGroup } from '@/types/split-view';

export type ShelfRevealNavigation = Shelves.ShelfRevealNavigation;
export type ShelfNavigation = Shelves.ShelfNavigation;

export const navigateShelfDirectory = (
  directory: string,
  group: EditorGroup,
  actions: { navigateToPath: (path: string) => void; navigateFromHome: (path: string) => void },
  switchTab: (groupId: string, tabId: string) => void,
): void => {
  const active = group.tabs.find((tab) => tab.id === group.activeTabId);
  if (!active?.type || active.type === 'folder') {
    actions.navigateToPath(directory);
    return;
  }
  const existing = group.tabs.find(
    (tab) => (!tab.type || tab.type === 'folder') && tab.path === directory,
  );
  if (existing) switchTab(group.id, existing.id);
  else actions.navigateFromHome(directory);
};

const isAbsolutePath = (path: unknown): path is string =>
  typeof path === 'string' &&
  path.startsWith('/') &&
  path.length <= 4096 &&
  !path.includes('\0') &&
  !path.split('/').includes('..');

export const isShelfRevealNavigation = (value: unknown): value is ShelfRevealNavigation => {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<ShelfRevealNavigation>;
  if (
    request.target !== 'reveal' ||
    !isAbsolutePath(request.directory) ||
    !Array.isArray(request.paths) ||
    request.paths.length === 0 ||
    request.paths.length > 256 ||
    typeof request.omittedCount !== 'number' ||
    !Number.isSafeInteger(request.omittedCount) ||
    request.omittedCount < 0 ||
    request.omittedCount > 256
  ) {
    return false;
  }
  return request.paths.every(
    (path) =>
      isAbsolutePath(path) && (path.slice(0, path.lastIndexOf('/')) || '/') === request.directory,
  );
};

let pending: ShelfRevealNavigation | null = null;
let receiver: ((request: ShelfRevealNavigation) => void) | null = null;

/** Keep only the latest native reveal if the normal workspace is still mounting. */
export const requestShelfRevealNavigation = (request: ShelfRevealNavigation): void => {
  if (!isShelfRevealNavigation(request)) return;
  const copy = { ...request, paths: [...request.paths] };
  if (receiver) receiver(copy);
  else pending = copy;
};

export const subscribeToShelfRevealNavigation = (
  callback: (request: ShelfRevealNavigation) => void,
): (() => void) => {
  receiver = callback;
  const request = pending;
  pending = null;
  if (request) callback(request);
  return () => {
    if (receiver === callback) receiver = null;
  };
};
