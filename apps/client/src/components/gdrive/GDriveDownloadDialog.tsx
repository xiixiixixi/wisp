import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { gdriveManager } from '@/lib/gdrive-plugin';
import { save } from '@tauri-apps/plugin-dialog';
import { Download, CheckCircle, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface GDriveDownloadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  fileId: string;
  fileName: string;
}

type DownloadState = 'idle' | 'picking' | 'downloading' | 'success' | 'error';

export const GDriveDownloadDialog = ({
  isOpen,
  onClose,
  accountId,
  fileId,
  fileName,
}: GDriveDownloadDialogProps) => {
  const { t } = useTranslation();
  const [downloadState, setDownloadState] = useState<DownloadState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    if (!isOpen) {
      setDownloadState('idle');
      setErrorMessage('');
      if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
      return;
    }

    // Auto-start the download flow when dialog opens
    startDownload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Clean up auto-close timer on unmount
  useEffect(() => {
    return () => {
      if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
    };
  }, []);

  const startDownload = async () => {
    setDownloadState('picking');
    setErrorMessage('');

    try {
      const savePath = await save({ defaultPath: fileName });

      if (!savePath) {
        // User cancelled the save dialog
        onClose();
        return;
      }

      setDownloadState('downloading');

      await gdriveManager.downloadFile(accountId, fileId, savePath);

      setDownloadState('success');

      toast({
        title: t('settings.gdrive.toastDownloadCompleteTitle'),
        description: t('settings.gdrive.toastDownloadCompleteDesc', { name: fileName }),
      });

      // Auto-close after a short delay on success
      autoCloseTimerRef.current = setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      const message = (err as Error).message;
      setErrorMessage(message);
      setDownloadState('error');

      toast({
        title: t('settings.gdrive.toastDownloadFailedTitle'),
        description: t('settings.gdrive.toastDownloadFailedDesc', {
          name: fileName,
          error: message,
        }),
        variant: 'destructive',
      });
    }
  };

  const handleClose = () => {
    if (downloadState === 'downloading') return; // Don't allow closing during download
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-96 max-w-full rounded-[2px] border border-xp-border bg-xp-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-medium text-xp-text">
            {t('settings.gdrive.downloadFileTitle')}
          </h3>
          <button
            onClick={handleClose}
            disabled={downloadState === 'downloading'}
            className="text-xp-text-muted hover:text-xp-text focus:outline-none disabled:opacity-50"
            aria-label={t('settings.gdrive.ariaCloseDownloadDialog')}
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="py-4 text-center">
          {(downloadState === 'idle' || downloadState === 'picking') && (
            <>
              <Download className="mx-auto mb-3 h-12 w-12 animate-pulse text-xp-blue" />
              <p className="mb-1 text-sm text-xp-text">{t('settings.gdrive.preparingDownload')}</p>
              <p className="text-xs text-xp-text-muted">{fileName}</p>
            </>
          )}

          {downloadState === 'downloading' && (
            <>
              <div className="mx-auto mb-3 h-12 w-12">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-xp-border border-t-xp-blue" />
              </div>
              <p className="mb-1 text-sm text-xp-text">{t('settings.gdrive.downloading')}</p>
              <p className="text-xs text-xp-text-muted">{fileName}</p>
            </>
          )}

          {downloadState === 'success' && (
            <>
              <CheckCircle className="mx-auto mb-3 h-12 w-12 text-xp-green" />
              <p className="mb-1 text-sm text-xp-text">{t('settings.gdrive.downloadComplete')}</p>
              <p className="text-xs text-xp-text-muted">{fileName}</p>
            </>
          )}

          {downloadState === 'error' && (
            <>
              <XCircle className="mx-auto mb-3 h-12 w-12 text-xp-red" />
              <p className="mb-1 text-sm text-xp-text">{t('settings.gdrive.downloadFailed')}</p>
              <p className="mb-3 text-xs text-xp-text-muted">{errorMessage}</p>
              <div className="flex justify-center space-x-2">
                <button
                  onClick={startDownload}
                  className="rounded-[2px] bg-xp-blue px-4 py-2 text-sm text-[var(--xp-bg)] transition-colors hover:bg-xp-blue-dark focus:outline-none"
                  aria-label={t('settings.gdrive.ariaRetryDownload')}
                >
                  {t('settings.gdrive.retry')}
                </button>
                <button
                  onClick={handleClose}
                  className="rounded-[2px] border border-xp-border px-4 py-2 text-sm text-xp-text transition-colors hover:bg-xp-surface-light focus:outline-none"
                  aria-label={t('settings.gdrive.ariaCancelDownload')}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
