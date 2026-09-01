import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/hooks/use-toast';
import { TauriAPI, type FileVersion } from '@/lib/tauri-api';
import {
  History,
  RotateCcw,
  Trash2,
  Eye,
  X,
  Clock,
  HardDrive,
  AlertTriangle,
  Plus,
  Trash,
} from 'lucide-react';
import { formatFileSize } from '@/lib/utils';

interface VersionHistoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  onRefetch?: () => void;
}

const formatTimestamp = (ts: string): string => {
  if (!ts || ts.length < 15) return ts;
  const year = ts.slice(0, 4);
  const month = ts.slice(4, 6);
  const day = ts.slice(6, 8);
  const hour = ts.slice(9, 11);
  const min = ts.slice(11, 13);
  const sec = ts.slice(13, 15);
  return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
};

const VersionHistoryDialog = ({
  isOpen,
  onClose,
  filePath,
  onRefetch,
}: VersionHistoryDialogProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  const loadVersions = useCallback(async () => {
    if (!filePath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await TauriAPI.listVersions(filePath);
      setVersions(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [filePath]);

  useEffect(() => {
    if (isOpen && filePath) {
      loadVersions();
      setPreviewContent(null);
      setPreviewVersion(null);
    }
  }, [isOpen, filePath, loadVersions]);

  const handleCreateVersion = async () => {
    setActionInProgress('creating');
    try {
      await TauriAPI.createVersion(filePath);
      toast({
        title: t('dialogs.versionHistory.toastCreatedTitle'),
        description: t('dialogs.versionHistory.toastCreatedDesc', { fileName }),
      });
      await loadVersions();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        title: t('dialogs.versionHistory.toastCreateFailedTitle'),
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRestore = async (versionNumber: number) => {
    setActionInProgress(`restore-${versionNumber}`);
    try {
      await TauriAPI.restoreVersion(filePath, versionNumber);
      toast({
        title: t('dialogs.versionHistory.toastRestoredTitle'),
        description: t('dialogs.versionHistory.toastRestoredDesc', { versionNumber, fileName }),
      });
      await loadVersions();
      onRefetch?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        title: t('dialogs.versionHistory.toastRestoreFailedTitle'),
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDelete = async (versionNumber: number) => {
    setActionInProgress(`delete-${versionNumber}`);
    try {
      await TauriAPI.deleteVersion(filePath, versionNumber);
      toast({
        title: t('dialogs.versionHistory.toastDeletedTitle'),
        description: t('dialogs.versionHistory.toastDeletedDesc', { versionNumber }),
      });
      await loadVersions();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        title: t('dialogs.versionHistory.toastDeleteFailedTitle'),
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDeleteAll = async () => {
    setActionInProgress('delete-all');
    try {
      const count = await TauriAPI.deleteAllVersions(filePath);
      toast({
        title: t('dialogs.versionHistory.toastDeleteAllTitle'),
        description: t('dialogs.versionHistory.toastDeleteAllDesc', { count }),
      });
      await loadVersions();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        title: t('dialogs.versionHistory.toastDeleteAllFailedTitle'),
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setActionInProgress(null);
    }
  };

  const handlePreview = async (versionNumber: number) => {
    if (previewVersion === versionNumber) {
      setPreviewContent(null);
      setPreviewVersion(null);
      return;
    }
    setActionInProgress(`preview-${versionNumber}`);
    try {
      const content = await TauriAPI.readVersionContent(filePath, versionNumber);
      setPreviewContent(content);
      setPreviewVersion(versionNumber);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({
        title: t('dialogs.versionHistory.toastPreviewFailedTitle'),
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setActionInProgress(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-[2px] border border-xp-border bg-xp-bg shadow-2xl">
        {/* Header */}
        <div className="border-xp-border/50 flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[2px] bg-xp-accent/10">
              <History size={18} className="text-xp-accent" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-xp-text">
                {t('dialogs.versionHistory.title')}
              </h2>
              <p
                className="mt-0.5 max-w-[360px] truncate text-xs text-xp-text-secondary"
                title={filePath}
              >
                {fileName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-[2px] text-xp-text-secondary transition-colors hover:bg-xp-surface hover:text-xp-text"
          >
            <X size={16} />
          </button>
        </div>

        {/* Actions bar */}
        <div className="border-xp-border/30 flex items-center gap-2 border-b px-5 py-3">
          <button
            onClick={handleCreateVersion}
            disabled={!!actionInProgress}
            className="flex items-center gap-1.5 rounded-[2px] bg-xp-accent/10 px-3 py-1.5 text-xs font-medium text-xp-accent transition-colors hover:bg-xp-accent/20 disabled:opacity-50"
          >
            <Plus size={14} />
            {t('dialogs.versionHistory.createSnapshot')}
          </button>
          {versions.length > 0 && (
            <button
              onClick={handleDeleteAll}
              disabled={!!actionInProgress}
              className="flex items-center gap-1.5 rounded-[2px] bg-xp-red/10 px-3 py-1.5 text-xs font-medium text-xp-red transition-colors hover:bg-xp-red/20 disabled:opacity-50"
            >
              <Trash size={14} />
              {t('dialogs.versionHistory.deleteAll')}
            </button>
          )}
          <div className="ml-auto text-xs text-xp-text-secondary">
            {t('dialogs.versionHistory.versionCount', { count: versions.length })}
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* eslint-disable-next-line no-nested-ternary */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-xp-accent border-t-transparent" />
              <span className="ml-3 text-sm text-xp-text-secondary">
                {t('dialogs.versionHistory.loading')}
              </span>
            </div>
          ) : // eslint-disable-next-line no-nested-ternary
          error ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <AlertTriangle size={24} className="mb-2 text-xp-red" />
              <p className="text-sm text-xp-red">{error}</p>
              <button
                onClick={loadVersions}
                className="mt-3 text-xs text-xp-accent hover:underline"
              >
                {t('dialogs.versionHistory.tryAgain')}
              </button>
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <History size={32} className="text-xp-text-secondary/40 mb-3" />
              <p className="text-sm text-xp-text-secondary">
                {t('dialogs.versionHistory.noVersions')}
              </p>
              <p className="text-xp-text-secondary/60 mt-1 text-xs">
                {t('dialogs.versionHistory.noVersionsHint')}
              </p>
            </div>
          ) : (
            <div className="divide-xp-border/30 divide-y">
              {versions.map((version) => (
                <div
                  key={version.version_number}
                  className="group px-5 py-3 transition-colors hover:bg-xp-surface-light/30"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[2px] bg-xp-surface">
                        <span className="text-xs font-medium text-xp-text-secondary">
                          v{version.version_number}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-xp-text">
                            {t('dialogs.versionHistory.versionLabel', {
                              n: version.version_number,
                            })}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-3">
                          <span className="flex items-center gap-1 text-xs text-xp-text-secondary">
                            <Clock size={11} />
                            {formatTimestamp(version.timestamp)}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-xp-text-secondary">
                            <HardDrive size={11} />
                            {formatFileSize(version.size)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => handlePreview(version.version_number)}
                        disabled={!!actionInProgress}
                        title={t('dialogs.versionHistory.previewTitle')}
                        className={`flex h-7 w-7 items-center justify-center rounded-[2px] transition-colors disabled:opacity-50 ${
                          previewVersion === version.version_number
                            ? 'bg-xp-accent/20 text-xp-accent'
                            : 'text-xp-text-secondary hover:bg-xp-surface hover:text-xp-text'
                        }`}
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        onClick={() => handleRestore(version.version_number)}
                        disabled={!!actionInProgress}
                        title={t('dialogs.versionHistory.restoreTitle')}
                        className="flex h-7 w-7 items-center justify-center rounded-[2px] text-xp-text-secondary transition-colors hover:bg-xp-green/10 hover:text-xp-green disabled:opacity-50"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(version.version_number)}
                        disabled={!!actionInProgress}
                        title={t('dialogs.versionHistory.deleteTitle')}
                        className="flex h-7 w-7 items-center justify-center rounded-[2px] text-xp-text-secondary transition-colors hover:bg-xp-red/10 hover:text-xp-red disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Inline preview */}
                  {previewVersion === version.version_number && previewContent !== null && (
                    <div className="border-xp-border/50 mt-3 overflow-hidden rounded-[2px] border bg-xp-bg">
                      <div className="border-xp-border/30 flex items-center justify-between border-b bg-xp-surface/50 px-3 py-1.5">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-xp-text-secondary">
                          {t('dialogs.versionHistory.previewLabel', { n: version.version_number })}
                        </span>
                        <button
                          onClick={() => {
                            setPreviewContent(null);
                            setPreviewVersion(null);
                          }}
                          className="text-xp-text-secondary hover:text-xp-text"
                        >
                          <X size={12} />
                        </button>
                      </div>
                      <pre className="max-h-[200px] overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs text-xp-text">
                        {previewContent.length > 10000
                          ? `${previewContent.slice(0, 10000)}\n\n${t('dialogs.versionHistory.truncated')}`
                          : previewContent}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-xp-border/50 flex items-center justify-end gap-2 border-t px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-[2px] px-4 py-1.5 text-xs font-medium text-xp-text-secondary transition-colors hover:bg-xp-surface"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VersionHistoryDialog;
