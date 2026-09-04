import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { TauriAPI, type FileOperationProgress } from '@/lib/tauri-api';
import {
  getLatestFileOperationProgress,
  suppressFileOperationProgress,
  subscribeToFileOperationProgress,
} from '@/lib/file-operation-progress';
import { notifyFilesChanged } from '@/lib/file-change-events';
import { BottomRightOverlayStackItem } from '@/components/ui/BottomRightOverlayStack';
import {
  recordTransfer,
  clearTransferRecord,
  undoLastTransfer,
} from '@/hooks/use-transfer-history';

interface TransferProgressToastProps {
  ids: string[];
  itemCount: number;
  mode: 'copy' | 'move';
  destDir: string;
  /** Small transfers run silently; only the completion toast is shown. */
  silent: boolean;
  onDismiss: () => void;
}

interface OpState {
  status: string;
  percent: number;
}

const TERMINAL_STATUSES = new Set(['Completed', 'Failed', 'Cancelled']);

const AUTO_DISMISS_MS = 8000;

/** Bottom-right toast showing drag transfer progress, then completion + undo. */
export const TransferProgressToast = ({
  ids,
  itemCount,
  mode,
  destDir,
  silent,
  onDismiss,
}: TransferProgressToastProps) => {
  const { t } = useTranslation();
  const [opStates, setOpStates] = useState<Map<string, OpState>>(new Map());
  const [currentFile, setCurrentFile] = useState('');
  const [undoing, setUndoing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const recordedRef = useRef(false);

  const states = [...opStates.values()];
  const failedCount = states.filter((o) => o.status === 'Failed').length;
  const completedCount = states.filter((o) => o.status === 'Completed').length;
  const allSettled = ids.every((id) => TERMINAL_STATUSES.has(opStates.get(id)?.status ?? ''));
  const phase = allSettled ? 'done' : 'running';

  // Average across operations; completed ones count as 100%. Per-op progress
  // only increases, so the overall bar never regresses.
  const percent =
    ids.length === 0
      ? 0
      : Math.round(
          states.reduce((sum, o) => sum + (o.status === 'Completed' ? 100 : o.percent), 0) /
            ids.length,
        );

  useLayoutEffect(() => {
    suppressFileOperationProgress(ids);
  }, [ids]);

  // Track operation statuses via the file-operation-progress event stream
  useEffect(() => {
    const updateProgress = (progress: FileOperationProgress) => {
      if (!ids.includes(progress.operation_id)) return;
      setOpStates((prev) => {
        const cur = prev.get(progress.operation_id);
        if (cur?.status === progress.status && cur.percent === progress.progress_percentage) {
          return prev;
        }
        const next = new Map(prev);
        next.set(progress.operation_id, {
          status: progress.status,
          percent: progress.progress_percentage,
        });
        return next;
      });
      if (progress.current_file) setCurrentFile(progress.current_file);
    };

    // Subscribe before reading the cache so an event cannot slip through the
    // small gap between those two steps.
    const unsubscribe = subscribeToFileOperationProgress(updateProgress);
    for (const id of ids) {
      const latest = getLatestFileOperationProgress(id);
      if (latest) updateProgress(latest);
    }
    return unsubscribe;
  }, [ids]);

  // Record the transfer once settled, then auto-dismiss the toast (which also
  // clears the undo record — Cmd+Z only works while the toast is visible).
  // Only actually-completed operations are recorded: Rust only pushes to the
  // undo stack on success, so the undo count must match or Cmd+Z would pop
  // unrelated history.
  useEffect(() => {
    if (phase !== 'done' || recordedRef.current) return;
    recordedRef.current = true;
    if (completedCount > 0) {
      recordTransfer({ count: completedCount, mode, destDir, timestamp: Date.now() });
    }
    const timer = setTimeout(() => {
      clearTransferRecord();
      onDismiss();
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [phase, completedCount, mode, destDir, onDismiss]);

  const handleCancel = async () => {
    setCancelling(true);
    setCancelError(null);

    try {
      const results = await Promise.all(ids.map((id) => TauriAPI.cancelFileOperation(id)));
      if (results.every((result) => result === true)) {
        setCancelling(false);
        onDismiss();
        return;
      }
    } catch {
      // The actionable, localized error stays in the transfer card below.
    }

    setCancelling(false);
    setCancelError(t('transfer.cancelFailed'));
  };

  const handleDismiss = () => {
    if (phase === 'done') clearTransferRecord();
    onDismiss();
  };

  const handleUndo = async () => {
    setUndoing(true);
    const ok = await undoLastTransfer();
    if (ok) await notifyFilesChanged();
    onDismiss();
  };

  // Silent transfers show nothing while running
  if (silent && phase === 'running') return null;

  const doneAction = mode === 'move' ? 'doneMove' : 'doneCopy';
  const donePlurality = itemCount === 1 ? 'one' : 'other';
  const doneLabelKey = `transfer.${doneAction}_${donePlurality}`;
  const doneLabel = t(doneLabelKey, { count: itemCount });
  const canUndo = !undoing && completedCount > 0;

  return (
    <BottomRightOverlayStackItem className="flex justify-end">
      <div
        role="region"
        aria-label={t('transfer.notificationLabel')}
        style={{
          position: 'relative',
          width: 320,
          maxWidth: '100%',
          padding: '12px 14px',
          borderRadius: '4px',
          backgroundColor: 'var(--xp-surface)',
          border: '1px solid var(--xp-border)',
          boxShadow: 'var(--xp-shadow-popover)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          fontSize: '12px',
          color: 'var(--xp-text)',
        }}
      >
        {phase === 'running' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span role="status" style={{ fontWeight: 500 }}>
                {t('transfer.progressTitle')}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: 'var(--xp-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {percent}%
                </span>
                <button
                  type="button"
                  onClick={handleDismiss}
                  aria-label={t('transfer.dismiss')}
                  title={t('transfer.dismiss')}
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xp-blue"
                  style={{
                    width: 28,
                    height: 28,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 0,
                    borderRadius: 2,
                    background: 'transparent',
                    color: 'var(--xp-text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div
              role="progressbar"
              aria-label={t('transfer.progressLabel')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, Math.max(0, percent))}
              style={{
                height: 4,
                borderRadius: 2,
                backgroundColor: 'var(--xp-surface-secondary)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: '100%',
                  backgroundColor: 'var(--xp-blue)',
                  transform: `scaleX(${Math.min(100, Math.max(0, percent)) / 100})`,
                  transformOrigin: 'left',
                  transition: 'transform 0.2s ease-out',
                }}
              />
            </div>
            <div
              style={{
                color: 'var(--xp-text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {currentFile}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                aria-busy={cancelling}
                aria-label={t(cancelling ? 'transfer.cancelling' : 'transfer.cancel')}
                style={{
                  padding: '4px 12px',
                  fontSize: '11px',
                  borderRadius: '4px',
                  border: '1px solid var(--xp-border)',
                  background: 'transparent',
                  color: 'var(--xp-text)',
                  cursor: cancelling ? 'default' : 'pointer',
                  opacity: cancelling ? 0.6 : 1,
                }}
              >
                {t(cancelling ? 'transfer.cancelling' : 'transfer.cancel')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div
                role="status"
                style={{ display: 'flex', minWidth: 0, alignItems: 'center', gap: '8px' }}
              >
                {failedCount > 0 ? (
                  <AlertTriangle size={16} color="var(--xp-red)" aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={16} color="var(--xp-green)" aria-hidden="true" />
                )}
                <span style={{ fontWeight: 500 }}>{doneLabel}</span>
                {failedCount > 0 && (
                  <span style={{ color: 'var(--xp-red)' }}>
                    {t('transfer.failed', { count: failedCount })}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleDismiss}
                aria-label={t('transfer.dismiss')}
                title={t('transfer.dismiss')}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-xp-blue"
                style={{
                  width: 28,
                  height: 28,
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 0,
                  borderRadius: 2,
                  background: 'transparent',
                  color: 'var(--xp-text-muted)',
                  cursor: 'pointer',
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={!canUndo}
                onClick={handleUndo}
                style={{
                  padding: '4px 12px',
                  fontSize: '11px',
                  borderRadius: '4px',
                  border: '1px solid var(--xp-blue)',
                  background: 'transparent',
                  color: 'var(--xp-blue)',
                  cursor: canUndo ? 'pointer' : 'default',
                  opacity: canUndo ? 1 : 0.5,
                }}
              >
                {t('transfer.undo')}
              </button>
            </div>
          </>
        )}
        {cancelError && (
          <div role="alert" style={{ color: 'var(--xp-red)', lineHeight: 1.4 }}>
            {cancelError}
          </div>
        )}
      </div>
    </BottomRightOverlayStackItem>
  );
};
