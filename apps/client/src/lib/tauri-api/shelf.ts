import { Shelves } from '@wisp/sdk';

export const shelfRequest = Shelves.shelfRequest;
export const listenToShelfState = Shelves.listenToShelfState;
export const listenToShelfCloudTest = Shelves.listenToShelfCloudTest;
export const listenToShelfCloudRevoke = Shelves.listenToShelfCloudRevoke;
export type {
  ShelfItem, ShelfRecord, ShelfShortcut, ShelfActionPreset, ShelfWatchedFolder,
  ShelfCloudAccount, ShelfCloudShare, ShelfCloudTestResult, ShelfCloudRevokeResult,
  ShelfSettings, ShelfState, ShelfRequest,
} from '@wisp/sdk';
