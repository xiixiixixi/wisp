import { useEffect, useReducer } from 'react';
import { TauriAPI } from '@/lib/tauri-api';

export interface TransferRecord {
  count: number;
  mode: 'copy' | 'move';
  destDir: string;
  timestamp: number;
}

/** A stable identity survives partial undo updates and distinguishes notices. */
export interface RecordedTransfer extends TransferRecord {
  readonly id: number;
}

// Module-level store: the drag drop handler lives outside React event flow,
// and Cmd+Z / the undo toast need a shared view of the last transfer.
let nextRecordId = 0;
let lastRecord: RecordedTransfer | null = null;
let undoInFlight: { recordId: number; promise: Promise<boolean> } | null = null;
const subscribers = new Set<() => void>();

const notify = () => {
  subscribers.forEach((fn) => fn());
};

export const recordTransfer = (record: TransferRecord): RecordedTransfer => {
  const recorded = { ...record, id: ++nextRecordId };
  lastRecord = recorded;
  notify();
  return recorded;
};

export const getLastTransfer = (): RecordedTransfer | null => lastRecord;

export const clearTransferRecord = (expected?: RecordedTransfer): void => {
  if (expected && expected.id !== lastRecord?.id) return;
  lastRecord = null;
  notify();
};

export const subscribeTransfers = (fn: () => void): (() => void) => {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
};

/**
 * Undo the last drag transfer by rolling back every recorded operation.
 * Each transferred item records one undoable operation in Rust.
 */
export const undoLastTransfer = (expected?: RecordedTransfer): Promise<boolean> => {
  const record = lastRecord;
  if (!record || (expected && expected.id !== record.id)) return Promise.resolve(false);
  if (undoInFlight) {
    return undoInFlight.recordId === record.id ? undoInFlight.promise : Promise.resolve(false);
  }

  const promise = (async () => {
    try {
      for (let i = 0; i < record.count; i++) {
        if (lastRecord?.id !== record.id) return false;
        const result = await TauriAPI.undoOperation();
        if (!result.success) return false;

        // On partial failure a retry must only undo the remaining items. Never
        // clear a newer transfer record that arrived while this request ran.
        if (lastRecord?.id !== record.id) return false;
        const count = lastRecord.count - 1;
        lastRecord = count > 0 ? { ...lastRecord, count } : null;
        notify();
      }
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    undoInFlight = null;
  });
  undoInFlight = { recordId: record.id, promise };
  return promise;
};

/** Re-render on transfer record changes; returns the latest record. */
export const useTransferHistory = (): RecordedTransfer | null => {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeTransfers(force), []);
  return lastRecord;
};
