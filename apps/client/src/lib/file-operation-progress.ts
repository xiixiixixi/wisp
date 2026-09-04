import { TauriAPI, type FileOperationProgress } from '@/lib/tauri-api';
import { dispatchLocalFilesChanged } from '@/lib/file-change-events';
import { isTauri } from '@/lib/transport';

type ProgressSubscriber = (progress: FileOperationProgress) => void;
type SuppressionSubscriber = (operationIds: readonly string[]) => void;

const TERMINAL_STATUSES = new Set(['Completed', 'Failed', 'Cancelled']);
const latestProgress = new Map<string, FileOperationProgress>();
const subscribers = new Set<ProgressSubscriber>();
const suppressionSubscribers = new Set<SuppressionSubscriber>();
const suppressedOperationIds = new Set<string>();
const suppressionTimers = new Map<string, ReturnType<typeof setTimeout>>();
let listenerPromise: Promise<void> | null = null;

const scheduleSuppressionCleanup = (operationId: string, delayMs: number) => {
  const existing = suppressionTimers.get(operationId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    suppressionTimers.delete(operationId);
    suppressedOperationIds.delete(operationId);
  }, delayMs);
  suppressionTimers.set(operationId, timer);
};

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
      if (suppressedOperationIds.has(progress.operation_id)) {
        // Keep the id suppressed briefly so every application-level listener
        // has consumed the terminal event before it becomes visible again.
        scheduleSuppressionCleanup(progress.operation_id, 30_000);
      }
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

/**
 * Hide operations already represented by a dedicated transfer notice from the
 * generic progress surface. Suppression survives that notice being closed and
 * is released shortly after the operation reaches a terminal state.
 */
export const suppressFileOperationProgress = (operationIds: readonly string[]): void => {
  const newlySuppressed = operationIds.filter((id) => {
    if (suppressedOperationIds.has(id)) return false;
    suppressedOperationIds.add(id);
    // Fallback cleanup for an operation that never emits a terminal event.
    scheduleSuppressionCleanup(id, 60 * 60 * 1000);
    return true;
  });

  if (newlySuppressed.length === 0) return;
  for (const subscriber of suppressionSubscribers) subscriber(newlySuppressed);
};

export const isFileOperationProgressSuppressed = (operationId: string): boolean =>
  suppressedOperationIds.has(operationId);

export const subscribeToFileOperationSuppression = (
  subscriber: SuppressionSubscriber,
): (() => void) => {
  suppressionSubscribers.add(subscriber);
  return () => suppressionSubscribers.delete(subscriber);
};
