import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    undoOperation: vi.fn(),
  },
}));

import { TauriAPI } from '@/lib/tauri-api';
import {
  recordTransfer,
  getLastTransfer,
  clearTransferRecord,
  subscribeTransfers,
  undoLastTransfer,
} from '@/hooks/use-transfer-history';

const mockUndoOperation = TauriAPI.undoOperation as ReturnType<typeof vi.fn>;

describe('use-transfer-history', () => {
  beforeEach(() => {
    clearTransferRecord();
    vi.clearAllMocks();
  });

  it('records and returns the last transfer', () => {
    recordTransfer({ count: 3, mode: 'move', destDir: '/dst', timestamp: 1 });
    expect(getLastTransfer()?.count).toBe(3);
    expect(getLastTransfer()?.mode).toBe('move');
  });

  it('undoes one operation per transferred item', async () => {
    mockUndoOperation.mockResolvedValue({ success: true, message: 'ok', operation_type: 'move' });
    recordTransfer({ count: 2, mode: 'move', destDir: '/dst', timestamp: 1 });

    const ok = await undoLastTransfer();

    expect(ok).toBe(true);
    expect(mockUndoOperation).toHaveBeenCalledTimes(2);
    expect(getLastTransfer()).toBeNull();
  });

  it('returns false when there is nothing to undo', async () => {
    expect(await undoLastTransfer()).toBe(false);
    expect(mockUndoOperation).not.toHaveBeenCalled();
  });

  it('stops early when an undo step fails', async () => {
    mockUndoOperation
      .mockResolvedValueOnce({ success: true, message: 'ok', operation_type: 'move' })
      .mockResolvedValueOnce({
        success: false,
        message: 'Nothing to undo',
        operation_type: 'none',
      });
    recordTransfer({ count: 3, mode: 'move', destDir: '/dst', timestamp: 1 });

    await undoLastTransfer();

    expect(mockUndoOperation).toHaveBeenCalledTimes(2);
  });

  it('notifies subscribers on record changes', () => {
    const fn = vi.fn();
    subscribeTransfers(fn);
    recordTransfer({ count: 1, mode: 'copy', destDir: '/d', timestamp: 2 });
    expect(fn).toHaveBeenCalled();
  });
});
