import { useEffect, useReducer } from 'react';
import { TauriAPI } from '@/lib/tauri-api';

export interface TransferRecord {
  count: number;
  mode: 'copy' | 'move';
  destDir: string;
  timestamp: number;
}

// Module-level store: the drag drop handler lives outside React event flow,
// and Cmd+Z / the undo toast need a shared view of the last transfer.
let lastRecord: TransferRecord | null = null;
const subscribers = new Set<() => void>();

const notify = () => {
  subscribers.forEach((fn) => fn());
};

export const recordTransfer = (record: TransferRecord): void => {
  lastRecord = record;
  notify();
};

export const getLastTransfer = (): TransferRecord | null => lastRecord;

export const clearTransferRecord = (): void => {
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
export const undoLastTransfer = async (): Promise<boolean> => {
  const record = lastRecord;
  if (!record) return false;
  for (let i = 0; i < record.count; i++) {
    const result = await TauriAPI.undoOperation();
    if (!result.success) break;
  }
  clearTransferRecord();
  return true;
};

/** Re-render on transfer record changes; returns the latest record. */
export const useTransferHistory = (): TransferRecord | null => {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeTransfers(force), []);
  return lastRecord;
};
