import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransferProgressToast } from '@/components/explorer/TransferProgressToast';
import type { FileOperationProgress } from '@/lib/tauri-api';
import english from '@/locales/en.json';
import chinese from '@/locales/zh.json';
import japanese from '@/locales/ja.json';
import indonesian from '@/locales/id.json';

const {
  cancelFileOperation,
  clearTransferRecord,
  getLatestFileOperationProgress,
  notifyFilesChanged,
  recordTransfer,
  suppressFileOperationProgress,
  subscribeToFileOperationProgress,
  undoLastTransfer,
} = vi.hoisted(() => ({
  cancelFileOperation: vi.fn().mockResolvedValue(true),
  clearTransferRecord: vi.fn(),
  getLatestFileOperationProgress: vi.fn(),
  notifyFilesChanged: vi.fn().mockResolvedValue(undefined),
  recordTransfer: vi.fn(),
  suppressFileOperationProgress: vi.fn(),
  subscribeToFileOperationProgress: vi.fn(),
  undoLastTransfer: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: { cancelFileOperation },
}));

vi.mock('@/lib/file-operation-progress', () => ({
  getLatestFileOperationProgress,
  suppressFileOperationProgress,
  subscribeToFileOperationProgress,
}));

vi.mock('@/hooks/use-transfer-history', () => ({
  recordTransfer,
  clearTransferRecord,
  undoLastTransfer,
}));

vi.mock('@/lib/file-change-events', () => ({
  notifyFilesChanged,
}));

let progressSubscriber: ((progress: FileOperationProgress) => void) | undefined;
const operationIds = ['copy-1', 'copy-2'];

const makeProgress = (
  operationId: string,
  status: string,
  progressPercentage: number,
): FileOperationProgress =>
  ({
    operation_id: operationId,
    operation_type: 'copy_file',
    status,
    progress_percentage: progressPercentage,
    current_file: `/tmp/${operationId}.txt`,
    source_path: `/tmp/${operationId}.txt`,
    total_files: 1,
    files_processed: status === 'Completed' ? 1 : 0,
    total_bytes: 100,
    speed_bytes_per_second: 10,
    estimated_remaining_seconds: 1,
    error_message: null,
  }) as FileOperationProgress;

describe('TransferProgressToast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cancelFileOperation.mockResolvedValue(true);
    progressSubscriber = undefined;
    getLatestFileOperationProgress.mockReturnValue(undefined);
    subscribeToFileOperationProgress.mockImplementation((subscriber) => {
      progressSubscriber = subscriber;
      return vi.fn();
    });
  });

  it('can hide running progress without cancelling the transfer', () => {
    const onDismiss = vi.fn();
    render(
      <TransferProgressToast
        ids={operationIds}
        itemCount={2}
        mode="copy"
        destDir="/tmp/destination"
        silent={false}
        onDismiss={onDismiss}
      />,
    );

    const region = screen.getByRole('region', { name: 'File transfer status' });
    expect(region).toBeInTheDocument();
    expect(region).not.toHaveAttribute('aria-live');
    expect(screen.getByRole('progressbar', { name: 'File transfer progress' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Transferring files');
    expect(screen.getByRole('status')).not.toHaveTextContent('0%');
    expect(suppressFileOperationProgress).toHaveBeenCalledWith(operationIds);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss transfer status' }));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(cancelFileOperation).not.toHaveBeenCalled();
    expect(clearTransferRecord).not.toHaveBeenCalled();
  });

  it('keeps cancellation as a separate, named action', async () => {
    const onDismiss = vi.fn();
    render(
      <TransferProgressToast
        ids={operationIds}
        itemCount={2}
        mode="copy"
        destDir="/tmp/destination"
        silent={false}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel transfer' }));

    await waitFor(() => {
      expect(cancelFileOperation).toHaveBeenCalledTimes(2);
      expect(onDismiss).toHaveBeenCalledOnce();
    });
  });

  it('keeps the notification visible when any cancellation returns false', async () => {
    cancelFileOperation.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const onDismiss = vi.fn();
    render(
      <TransferProgressToast
        ids={operationIds}
        itemCount={2}
        mode="copy"
        destDir="/tmp/destination"
        silent={false}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel transfer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Some items could not be cancelled. Try again.',
    );
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'File transfer status' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel transfer' })).toBeEnabled();
  });

  it('keeps the notification visible when cancellation rejects', async () => {
    cancelFileOperation.mockRejectedValueOnce(new Error('backend unavailable'));
    const onDismiss = vi.fn();
    render(
      <TransferProgressToast
        ids={operationIds}
        itemCount={2}
        mode="move"
        destDir="/tmp/destination"
        silent={false}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel transfer' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Some items could not be cancelled. Try again.',
    );
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'File transfer status' })).toBeInTheDocument();
  });

  it('clears the temporary undo record when completion is dismissed', async () => {
    const onDismiss = vi.fn();
    render(
      <TransferProgressToast
        ids={operationIds}
        itemCount={2}
        mode="copy"
        destDir="/tmp/destination"
        silent={false}
        onDismiss={onDismiss}
      />,
    );

    await act(async () => {
      progressSubscriber?.(makeProgress('copy-1', 'Completed', 100));
      progressSubscriber?.(makeProgress('copy-2', 'Completed', 100));
    });

    await waitFor(() => {
      expect(screen.getByText('Copied 2 items')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Copied 2 items');
      expect(screen.getByRole('region', { name: 'File transfer status' })).not.toHaveAttribute(
        'aria-live',
      );
      expect(recordTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ count: 2, mode: 'copy', destDir: '/tmp/destination' }),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss transfer status' }));

    expect(clearTransferRecord).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it.each([
    ['copy', 'Copied 1 item'],
    ['move', 'Moved 1 item'],
  ] as const)('uses the singular completion label for a one-item %s', async (mode, label) => {
    render(
      <TransferProgressToast
        ids={['single-operation']}
        itemCount={1}
        mode={mode}
        destDir="/tmp/destination"
        silent={false}
        onDismiss={vi.fn()}
      />,
    );

    await act(async () => {
      progressSubscriber?.(makeProgress('single-operation', 'Completed', 100));
    });

    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it('keeps count placeholders and cancellation errors aligned across locales', () => {
    const locales = [english, chinese, japanese, indonesian];
    const countKeys = ['doneMove_one', 'doneMove_other', 'doneCopy_one', 'doneCopy_other'] as const;

    for (const locale of locales) {
      for (const key of countKeys) {
        expect(locale.transfer[key]).toContain('{{count}}');
      }
      expect(locale.transfer.cancelFailed).toBeTruthy();
    }

    expect(english.transfer.doneCopy_one).toBe('Copied {{count}} item');
    expect(english.transfer.doneCopy_other).toBe('Copied {{count}} items');
    expect(english.transfer.doneMove_one).toBe('Moved {{count}} item');
    expect(english.transfer.doneMove_other).toBe('Moved {{count}} items');
    expect(chinese.transfer.cancelFailed).toBe('部分项目取消失败，请重试。');
  });
});
