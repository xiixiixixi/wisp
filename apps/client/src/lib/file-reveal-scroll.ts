export const FILE_REVEAL_SCROLL_EVENT = 'wisp-reveal-file-scroll';

export interface FileRevealScrollRequest {
  groupId: string;
  directory: string;
  path: string;
}

let pending: FileRevealScrollRequest | null = null;

export const pendingFileRevealScroll = (): FileRevealScrollRequest | null => pending;

export const consumeFileRevealScroll = (request: FileRevealScrollRequest): void => {
  if (pending === request) pending = null;
};

export const cancelFileRevealScrollOutside = (groupId: string, directory: string): void => {
  if (pending && (pending.groupId !== groupId || pending.directory !== directory)) pending = null;
};

export const cancelFileRevealScrollForGroup = (groupId: string): void => {
  if (pending?.groupId === groupId) pending = null;
};

/** A reveal scroll is explicit and must not be inferred from ordinary selection changes. */
export const requestFileRevealScroll = (request: FileRevealScrollRequest): boolean => {
  pending = { ...request };
  return !window.dispatchEvent(
    new CustomEvent(FILE_REVEAL_SCROLL_EVENT, {
      detail: pending,
      cancelable: true,
    }),
  );
};
