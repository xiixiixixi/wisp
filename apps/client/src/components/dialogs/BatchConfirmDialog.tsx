import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Trash2,
  FolderInput,
  FileEdit,
  ShieldAlert,
  FolderClosed,
  FileIcon,
  ArrowRight,
  X,
} from 'lucide-react';
import type { FileEntry } from '@/lib/tauri-api';
import { formatFileSize } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

export type BatchOperationType = 'delete' | 'move' | 'rename' | 'secure-delete' | string;

export interface BatchConfirmDialogProps {
  isOpen: boolean;
  operation: BatchOperationType;
  files: FileEntry[];
  /** Optional destination path for move operations */
  destination?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const getExtension = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : '';
};

// ── Component ────────────────────────────────────────────────────────────────

const BatchConfirmDialog = ({
  isOpen,
  operation,
  files,
  destination,
  onConfirm,
  onCancel,
}: BatchConfirmDialogProps) => {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => cancelButtonRef.current?.focus());
    return () => previouslyFocusedRef.current?.focus();
  }, [isOpen]);

  if (!isOpen || files.length === 0) return null;

  const OPERATION_META: Record<
    string,
    {
      label: string;
      icon: React.ReactNode;
      destructive: boolean;
      warning?: string;
      confirmLabel: string;
      confirmClass: string;
    }
  > = {
    delete: {
      label: t('dialogs.batchConfirm.operationDelete'),
      icon: <Trash2 size={20} className="text-xp-red" />,
      destructive: true,
      warning: t('dialogs.batchConfirm.warningDelete'),
      confirmLabel: t('dialogs.batchConfirm.confirmDelete'),
      confirmClass: 'bg-red-600 hover:bg-red-700 text-white',
    },
    move: {
      label: t('dialogs.batchConfirm.operationMove'),
      icon: <FolderInput size={20} className="text-xp-blue" />,
      destructive: false,
      confirmLabel: t('dialogs.batchConfirm.confirmMove'),
      confirmClass: 'bg-xp-blue hover:opacity-90 text-white',
    },
    rename: {
      label: t('dialogs.batchConfirm.operationRename'),
      icon: <FileEdit size={20} className="text-xp-yellow" />,
      destructive: false,
      confirmLabel: t('dialogs.batchConfirm.confirmRename'),
      confirmClass: 'bg-xp-blue hover:opacity-90 text-white',
    },
    'secure-delete': {
      label: t('dialogs.batchConfirm.operationSecureDelete'),
      icon: <ShieldAlert size={20} className="text-xp-red" />,
      destructive: true,
      warning: t('dialogs.batchConfirm.warningSecureDelete'),
      confirmLabel: t('dialogs.batchConfirm.confirmSecureDelete'),
      confirmClass: 'bg-red-600 hover:bg-red-700 text-white',
    },
  };

  const meta = OPERATION_META[operation] ?? {
    label: operation.charAt(0).toUpperCase() + operation.slice(1),
    icon: <AlertTriangle size={20} className="text-xp-yellow" />,
    destructive: false,
    confirmLabel: t('dialogs.batchConfirm.confirmGeneric', { operation }),
    confirmClass: 'bg-xp-blue hover:opacity-90 text-white',
  };

  const totalSize = files.reduce((sum, f) => sum + (f.is_dir ? 0 : f.size), 0);
  const dirCount = files.filter((f) => f.is_dir).length;
  const fileCount = files.length - dirCount;

  // Build summary text
  const parts: string[] = [];
  if (fileCount > 0) parts.push(t('dialogs.batchConfirm.fileCount', { count: fileCount }));
  if (dirCount > 0) parts.push(t('dialogs.batchConfirm.folderCount', { count: dirCount }));
  const summaryText = parts.join(', ');
  const sizeText = totalSize > 0 ? formatFileSize(totalSize) : null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
    if (e.key === 'Tab' && dialogRef.current) {
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-labelledby="batch-confirm-title"
        aria-describedby={meta.warning ? 'batch-confirm-warning' : undefined}
        aria-modal="true"
        tabIndex={-1}
        className="flex max-h-[80vh] w-[540px] max-w-[90vw] flex-col rounded-lg border border-xp-border bg-xp-surface shadow-2xl outline-none"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-xp-border p-5">
          <div className="flex items-center gap-3">
            {meta.icon}
            <h2 id="batch-confirm-title" className="text-lg font-semibold text-xp-text">
              {t('dialogs.batchConfirm.title', { label: meta.label, count: files.length })}
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="rounded-md p-2 transition-colors hover:bg-xp-surface-light"
            aria-label={t('common.close')}
          >
            <X size={16} className="text-xp-text-muted" aria-hidden="true" />
          </button>
        </div>

        {/* Warning Banner (destructive ops only) */}
        {meta.destructive && meta.warning && (
          <div className="mx-5 mt-4 flex shrink-0 items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-xp-red" />
            <p id="batch-confirm-warning" className="text-sm text-xp-red">
              {meta.warning}
            </p>
          </div>
        )}

        {/* Destination (move operations) */}
        {operation === 'move' && destination && (
          <div className="mx-5 mt-4 flex shrink-0 items-center gap-2 rounded-lg border border-xp-border bg-xp-surface-light p-3">
            <ArrowRight size={16} className="shrink-0 text-xp-blue" />
            <div className="min-w-0">
              <div className="text-xs text-xp-text-muted">
                {t('dialogs.batchConfirm.destination')}
              </div>
              <div className="truncate text-sm text-xp-text" title={destination}>
                {destination}
              </div>
            </div>
          </div>
        )}

        {/* File list */}
        <div className="mx-5 mt-4 min-h-0 flex-1 overflow-hidden">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-xp-text-muted">
            {t('dialogs.batchConfirm.affectedItems')}
          </div>
          <div className="max-h-[280px] overflow-y-auto rounded-lg border border-xp-border bg-xp-bg">
            {files.map((file, index) => (
              <div
                key={file.path}
                className={`flex items-center gap-3 px-3 py-2 text-sm ${
                  index < files.length - 1 ? 'border-xp-border/50 border-b' : ''
                }`}
              >
                {/* Icon */}
                {file.is_dir ? (
                  <FolderClosed size={16} className="shrink-0 text-xp-blue" />
                ) : (
                  <FileIcon size={16} className="shrink-0 text-xp-text-muted" />
                )}

                {/* Name + path */}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xp-text" title={file.name}>
                    {file.name}
                  </div>
                  <div className="truncate text-xs text-xp-text-muted" title={file.path}>
                    {file.path}
                  </div>
                </div>

                {/* Type */}
                <div className="w-12 shrink-0 text-right text-xs text-xp-text-muted">
                  {file.is_dir ? t('common.folder') : getExtension(file.name) || t('common.file')}
                </div>

                {/* Size */}
                <div className="w-16 shrink-0 text-right text-xs text-xp-text-muted">
                  {file.is_dir ? '--' : formatFileSize(file.size)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Summary line */}
        <div className="mx-5 mt-3 shrink-0 text-xs text-xp-text-muted">
          {summaryText}
          {sizeText ? t('dialogs.batchConfirm.sizeTotal', { size: sizeText }) : ''}
        </div>

        {/* Footer */}
        <div className="mt-4 flex shrink-0 justify-end gap-3 border-t border-xp-border p-5">
          <button
            ref={cancelButtonRef}
            onClick={onCancel}
            className="rounded-md border border-xp-border px-4 py-2 text-sm text-xp-text transition-colors hover:bg-xp-surface-light"
            aria-label={t('common.cancel')}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm transition-colors ${meta.confirmClass}`}
            aria-label={meta.confirmLabel}
          >
            {meta.icon}
            <span>{meta.confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default BatchConfirmDialog;
