import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TauriAPI, type FileOperationProgress } from '@/lib/tauri-api';
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
  const [statusMap, setStatusMap] = useState<Map<string, string>>(new Map());
  const [percent, setPercent] = useState(0);
  const [currentFile, setCurrentFile] = useState('');
  const [undoing, setUndoing] = useState(false);
  const recordedRef = useRef(false);

  const failedCount = [...statusMap.values()].filter((s) => s === 'Failed').length;
  const allSettled = ids.every((id) => TERMINAL_STATUSES.has(statusMap.get(id) ?? ''));
  const phase = allSettled ? 'done' : 'running';

  // Track operation statuses via the file-operation-progress event stream
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void TauriAPI.listenToFileOperationProgress((progress: FileOperationProgress) => {
      if (!ids.includes(progress.operation_id)) return;
      setStatusMap((prev) => {
        if (prev.get(progress.operation_id) === progress.status) return prev;
        const next = new Map(prev);
        next.set(progress.operation_id, progress.status);
        return next;
      });
      if (progress.current_file) setCurrentFile(progress.current_file);
      setPercent((prev) => Math.max(prev, progress.progress_percentage));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [ids]);

  // Record the transfer once settled, then auto-dismiss the toast (which also
  // clears the undo record — Cmd+Z only works while the toast is visible).
  useEffect(() => {
    if (phase !== 'done' || recordedRef.current) return;
    recordedRef.current = true;
    recordTransfer({ count: itemCount, mode, destDir, timestamp: Date.now() });
    const timer = setTimeout(() => {
      clearTransferRecord();
      onDismiss();
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [phase, itemCount, mode, destDir, onDismiss]);

  const handleCancel = async () => {
    await Promise.all(ids.map((id) => TauriAPI.cancelFileOperation(id)));
    onDismiss();
  };

  const handleUndo = async () => {
    setUndoing(true);
    const ok = await undoLastTransfer();
    if (ok) window.dispatchEvent(new CustomEvent('files-changed'));
    onDismiss();
  };

  // Silent transfers show nothing while running
  if (silent && phase === 'running') return null;

  const doneLabel = t(mode === 'move' ? 'transfer.doneMove' : 'transfer.doneCopy', {
    count: itemCount,
  });

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        zIndex: 99998,
        width: 320,
        padding: '12px 14px',
        borderRadius: '10px',
        backgroundColor: 'var(--xp-surface)',
        border: '1px solid var(--xp-border)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
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
            <span style={{ fontWeight: 600 }}>{t('transfer.progressTitle')}</span>
            <span style={{ color: 'var(--xp-text-muted)' }}>{Math.round(percent)}%</span>
          </div>
          <div
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
                width: `${Math.min(100, percent)}%`,
                backgroundColor: 'var(--xp-blue)',
                transition: 'width 0.2s',
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
              style={{
                padding: '4px 12px',
                fontSize: '11px',
                borderRadius: '5px',
                border: '1px solid var(--xp-border)',
                background: 'transparent',
                color: 'var(--xp-text)',
                cursor: 'pointer',
              }}
            >
              {t('transfer.cancel')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontSize: '14px',
                color: failedCount > 0 ? 'var(--xp-red)' : 'var(--xp-green)',
              }}
            >
              {failedCount > 0 ? '⚠' : '✓'}
            </span>
            <span style={{ fontWeight: 600 }}>{doneLabel}</span>
            {failedCount > 0 && (
              <span style={{ color: 'var(--xp-red)' }}>
                {t('transfer.failed', { count: failedCount })}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              disabled={undoing || failedCount >= itemCount}
              onClick={handleUndo}
              style={{
                padding: '4px 12px',
                fontSize: '11px',
                borderRadius: '5px',
                border: '1px solid var(--xp-blue)',
                background: 'transparent',
                color: 'var(--xp-blue)',
                cursor: undoing || failedCount >= itemCount ? 'default' : 'pointer',
                opacity: undoing || failedCount >= itemCount ? 0.5 : 1,
              }}
            >
              {t('transfer.undo')}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
