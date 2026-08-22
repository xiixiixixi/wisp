import { TauriAPI, type FileOperationProgress } from '@/lib/tauri-api';
import { dispatchLocalFilesChanged } from '@/lib/file-change-events';
import { isTauri } from '@/lib/transport';

type ProgressSubscriber = (progress: FileOperationProgress) => void;

const TERMINAL_STATUSES = new Set(['Completed', 'Failed', 'Cancelled']);
const latestProgress = new Map<string, FileOperationProgress>();
const subscribers = new Set<ProgressSubscriber>();
let listenerPromise: Promise<void> | null = null;

/**
 * Start one early progress listener per Wisp window. Keeping the latest event
 * closes the race where a fast rename finishes before its toast mounts.
 */
export const ensureFileOperationProgressListener = async (): Promise<void> => {
  if (!isTauri()) return;
  if (listenerPromise) return listenerPromise;

  listenerPromise = TauriAPI.listenToFileOperationProgress((progress) => {
    latestProgress.set(progress.operation_id, progress);
    for (const subscriber of subscribers) subscriber(progress);

    // Rust emits progress application-wide, so this refreshes every open Wisp
    // window without another broadcast round trip.
    if (TERMINAL_STATUSES.has(progress.status)) {
      dispatchLocalFilesChanged();
    }
  })
    .then(() => undefined)
    .catch((error) => {
      listenerPromise = null;
      console.warn('Failed to listen for file operation progress:', error);
    });

  return listenerPromise;
};

export const getLatestFileOperationProgress = (
  operationId: string,
): FileOperationProgress | undefined => latestProgress.get(operationId);

export const subscribeToFileOperationProgress = (subscriber: ProgressSubscriber): (() => void) => {
  subscribers.add(subscriber);
  void ensureFileOperationProgressListener();
  return () => subscribers.delete(subscriber);
};
