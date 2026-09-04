import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { TauriAPI, type FileOperationProgress } from '@/lib/tauri-api';
import { formatFileSize } from '@/lib/utils';
import { X, Square } from 'lucide-react';
import { BottomRightOverlayStackItem } from '@/components/ui/BottomRightOverlayStack';
import {
  isFileOperationProgressSuppressed,
  subscribeToFileOperationSuppression,
} from '@/lib/file-operation-progress';

const formatSpeed = (bytesPerSecond: number, t: TFunction): string => {
  if (bytesPerSecond <= 0) return '—';
  return t('dialogs.fileOp.speedPerSecond', { speed: formatFileSize(bytesPerSecond) });
};

const formatETA = (seconds: number | undefined, t: TFunction): string => {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return t('dialogs.fileOp.etaSeconds', { seconds: Math.ceil(seconds) });
  if (seconds < 3600) {
    return t('dialogs.fileOp.etaMinutesSeconds', {
      minutes: Math.floor(seconds / 60),
      seconds: Math.ceil(seconds % 60),
    });
  }
  return t('dialogs.fileOp.etaHoursMinutes', {
    hours: Math.floor(seconds / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
  });
};

const getOperationLabel = (operationType: string | undefined, t: TFunction): string => {
  const normalized = operationType
    ?.trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const labelKeys: Record<string, string> = {
    copy: 'dialogs.fileOp.operationCopy',
    copy_file: 'dialogs.fileOp.operationCopy',
    copy_directory: 'dialogs.fileOp.operationCopyFolder',
    move: 'dialogs.fileOp.operationMove',
    move_file: 'dialogs.fileOp.operationMove',
    compress: 'dialogs.fileOp.operationCompress',
    extract: 'dialogs.fileOp.operationExtract',
    secure_delete: 'dialogs.fileOp.operationSecureDelete',
    encrypt: 'dialogs.fileOp.operationEncrypt',
    decrypt: 'dialogs.fileOp.operationDecrypt',
    accelerated_copy_file: 'dialogs.fileOp.operationAcceleratedCopy',
    accelerated_copy_directory: 'dialogs.fileOp.operationAcceleratedCopyFolder',
  };

  return normalized && labelKeys[normalized]
    ? t(labelKeys[normalized])
    : t('dialogs.fileOp.fileOperation');
};

const getStatusLabel = (op: FileOperationProgress, t: TFunction): string => {
  switch (op.status) {
    case 'Completed':
      return t('dialogs.fileOp.statusDone');
    case 'Cancelled':
      return t('dialogs.fileOp.statusCancelled');
    case 'Failed':
      return op.error_message || t('dialogs.fileOp.statusFailed');
    default:
      return `${Math.round(op.progress_percentage || 0)}%`;
  }
};

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'Completed':
      return 'bg-xp-green';
    case 'Failed':
      return 'bg-xp-red';
    case 'Cancelled':
      return 'bg-xp-yellow';
    default:
      return 'bg-xp-lime';
  }
};

const FileOperationProgressDialog = () => {
  const { t } = useTranslation();
  const [operations, setOperations] = useState<Map<string, FileOperationProgress>>(new Map());
  const dismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Operation ids are unique for the lifetime of the progress listener. Keep
  // manually dismissed ids for that same lifetime so late/out-of-order events
  // cannot recreate a notification the user explicitly hid.
  const dismissedOperationIds = useRef<Set<string>>(new Set());

  // Clean up all pending dismiss timers on unmount
  useEffect(() => {
    const timers = dismissTimers.current;
    const dismissedIds = dismissedOperationIds.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      dismissedIds.clear();
    };
  }, []);

  const handleProgress = useCallback((progress: FileOperationProgress) => {
    if (
      dismissedOperationIds.current.has(progress.operation_id) ||
      isFileOperationProgressSuppressed(progress.operation_id)
    ) {
      return;
    }

    setOperations((prev) => {
      const next = new Map(prev);
      next.set(progress.operation_id, progress);
      return next;
    });

    // Auto-dismiss completed/failed/cancelled after 4s
    if (
      progress.status === 'Completed' ||
      progress.status === 'Failed' ||
      progress.status === 'Cancelled'
    ) {
      // Clear any existing timer for this operation
      const existingTimer = dismissTimers.current.get(progress.operation_id);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(() => {
        dismissTimers.current.delete(progress.operation_id);
        setOperations((prev) => {
          const next = new Map(prev);
          next.delete(progress.operation_id);
          return next;
        });
      }, 4000);
      dismissTimers.current.set(progress.operation_id, timer);
    }
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    TauriAPI.listenToFileOperationProgress(handleProgress).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [handleProgress]);

  useEffect(
    () =>
      subscribeToFileOperationSuppression((operationIds) => {
        for (const id of operationIds) {
          const timer = dismissTimers.current.get(id);
          if (timer) clearTimeout(timer);
          dismissTimers.current.delete(id);
        }
        setOperations((prev) => {
          const next = new Map(prev);
          for (const id of operationIds) next.delete(id);
          return next;
        });
      }),
    [],
  );

  const dismiss = (id: string) => {
    dismissedOperationIds.current.add(id);
    const timer = dismissTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      dismissTimers.current.delete(id);
    }
    setOperations((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const cancelOperation = useCallback(async (id: string) => {
    await TauriAPI.cancelFileOperation(id);
  }, []);

  if (operations.size === 0) return null;

  return (
    <BottomRightOverlayStackItem>
      <div
        role="region"
        aria-label={t('dialogs.fileOp.regionLabel')}
        className="flex w-full flex-col gap-2"
      >
        {Array.from(operations.values()).map((op) => {
          const fileName =
            op.current_file?.split(/[/\\]/).pop() ||
            op.source_path?.split(/[/\\]/).pop() ||
            t('dialogs.fileOp.unknownFile');
          const isActive = op.status === 'Starting' || op.status === 'InProgress';
          const isDone = op.status === 'Completed';
          const isTerminal =
            op.status === 'Completed' || op.status === 'Failed' || op.status === 'Cancelled';
          const operationLabel = getOperationLabel(op.operation_type, t);

          return (
            <div
              key={op.operation_id}
              role="group"
              aria-label={t('dialogs.fileOp.operationStatus', {
                operation: operationLabel,
                name: fileName,
              })}
              className="rounded-[2px] border border-xp-border bg-xp-surface p-3 shadow-xl"
            >
              {/* Header */}
              <div className="mb-1.5 flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${getStatusColor(op.status)} ${isActive ? 'animate-pulse' : ''}`}
                  />
                  <span className="truncate text-xs font-medium text-xp-text">
                    {operationLabel}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {isActive && (
                    <button
                      type="button"
                      onClick={() => cancelOperation(op.operation_id)}
                      className="flex h-7 w-7 items-center justify-center rounded-[2px] text-xp-text-muted transition-colors hover:bg-xp-bg hover:text-xp-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xp-blue"
                      aria-label={t('dialogs.fileOp.cancelOperationFor', { name: fileName })}
                      title={t('dialogs.fileOp.cancelOperationFor', { name: fileName })}
                    >
                      <Square size={10} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => dismiss(op.operation_id)}
                    className="flex h-7 w-7 items-center justify-center rounded-[2px] text-xp-text-muted transition-colors hover:bg-xp-bg hover:text-xp-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xp-blue"
                    aria-label={t('dialogs.fileOp.dismissOperation', { name: fileName })}
                    title={t('dialogs.fileOp.dismissOperation', { name: fileName })}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Current file */}
              <div
                className="mb-1.5 truncate text-[11px] text-xp-text-muted"
                title={op.current_file}
              >
                {fileName}
              </div>

              {/* Progress bar */}
              <div
                role="progressbar"
                aria-label={t('dialogs.fileOp.progressFor', { name: fileName })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, Math.max(0, Math.round(op.progress_percentage || 0)))}
                className="mb-1.5 h-1.5 w-full overflow-hidden rounded-[2px] bg-xp-bg"
              >
                <div
                  className={`h-full w-full origin-left rounded-[2px] transition-transform duration-300 ${getStatusColor(op.status)}`}
                  style={{
                    transform: `scaleX(${Math.min(100, Math.max(0, op.progress_percentage || 0)) / 100})`,
                  }}
                />
              </div>

              {/* Stats */}
              <div className="flex items-center justify-between text-[10px] text-xp-text-muted">
                <span role={isTerminal ? 'status' : undefined}>
                  {getStatusLabel(op, t)}
                  {isActive &&
                    op.total_files > 1 &&
                    ` (${op.files_processed}/${op.total_files} ${t('dialogs.fileOp.files')})`}
                </span>
                {isActive && (
                  <span>
                    {formatSpeed(op.speed_bytes_per_second, t)}
                    {op.estimated_remaining_seconds
                      ? ` \u00B7 ${formatETA(op.estimated_remaining_seconds, t)}`
                      : ''}
                  </span>
                )}
                {isDone && op.total_bytes > 0 && <span>{formatFileSize(op.total_bytes)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </BottomRightOverlayStackItem>
  );
};

export default FileOperationProgressDialog;
