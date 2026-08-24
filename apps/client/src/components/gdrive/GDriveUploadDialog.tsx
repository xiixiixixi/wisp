import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { gdriveManager } from '@/lib/gdrive-plugin';
import { open } from '@tauri-apps/plugin-dialog';
import { Upload, CheckCircle, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface GDriveUploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  parentFolderId: string;
  onUploadComplete: () => void;
}

type UploadState = 'idle' | 'picking' | 'uploading' | 'success' | 'error';

export const GDriveUploadDialog = ({
  isOpen,
  onClose,
  accountId,
  parentFolderId,
  onUploadComplete,
}: GDriveUploadDialogProps) => {
  const { t } = useTranslation();
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    if (!isOpen) {
      setUploadState('idle');
      setErrorMessage('');
      setSelectedFileName('');
      if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
      return;
    }

    // Auto-start the upload flow when dialog opens
    startUpload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Clean up auto-close timer on unmount
  useEffect(() => {
    return () => {
      if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
    };
  }, []);

  const startUpload = async () => {
    setUploadState('picking');
    setErrorMessage('');

    try {
      const selected = await open({ multiple: false });

      if (!selected) {
        // User cancelled the file picker
        onClose();
        return;
      }

      const filePath = Array.isArray(selected) ? selected[0] : selected;
      const fileName = filePath.split(/[/\\]/).pop() || 'file';
      setSelectedFileName(fileName);
      setUploadState('uploading');

      await gdriveManager.uploadFile(accountId, filePath, parentFolderId);

      setUploadState('success');

      toast({
        title: t('settings.gdrive.toastUploadCompleteTitle'),
        description: t('settings.gdrive.toastUploadCompleteDesc', { name: fileName }),
      });

      onUploadComplete();

      // Auto-close after a short delay on success
      autoCloseTimerRef.current = setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      const message = (err as Error).message;
      setErrorMessage(message);
      setUploadState('error');

      toast({
        title: t('settings.gdrive.toastUploadFailedTitle'),
        description: t('settings.gdrive.toastUploadFailedDesc', { error: message }),
        variant: 'destructive',
      });
    }
  };

  const handleClose = () => {
    if (uploadState === 'uploading') return; // Don't allow closing during upload
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-96 max-w-full rounded-lg border border-xp-border bg-xp-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-medium text-xp-text">
            {t('settings.gdrive.uploadFileTitle')}
          </h3>
          <button
            onClick={handleClose}
            disabled={uploadState === 'uploading'}
            className="text-xp-text-muted hover:text-xp-text focus:outline-none focus:ring-1 focus:ring-xp-blue disabled:opacity-50"
            aria-label={t('settings.gdrive.ariaCloseUploadDialog')}
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="py-4 text-center">
          {(uploadState === 'idle' || uploadState === 'picking') && (
            <>
              <Upload className="mx-auto mb-3 h-12 w-12 animate-pulse text-xp-blue" />
              <p className="mb-1 text-sm text-xp-text">{t('settings.gdrive.selectFileToUpload')}</p>
              <p className="text-xs text-xp-text-muted">{t('settings.gdrive.chooseFileHint')}</p>
            </>
          )}

          {uploadState === 'uploading' && (
            <>
              <div className="mx-auto mb-3 h-12 w-12">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-xp-border border-t-xp-blue" />
              </div>
              <p className="mb-1 text-sm text-xp-text">{t('settings.gdrive.uploading')}</p>
              <p className="text-xs text-xp-text-muted">{selectedFileName}</p>
            </>
          )}

          {uploadState === 'success' && (
            <>
              <CheckCircle className="mx-auto mb-3 h-12 w-12 text-xp-green" />
              <p className="mb-1 text-sm text-xp-text">{t('settings.gdrive.uploadComplete')}</p>
              <p className="text-xs text-xp-text-muted">{selectedFileName}</p>
            </>
          )}

          {uploadState === 'error' && (
            <>
              <XCircle className="mx-auto mb-3 h-12 w-12 text-xp-red" />
              <p className="mb-1 text-sm text-xp-text">{t('settings.gdrive.uploadFailed')}</p>
              <p className="mb-3 text-xs text-xp-text-muted">{errorMessage}</p>
              <div className="flex justify-center space-x-2">
                <button
                  onClick={startUpload}
                  className="rounded bg-xp-blue px-4 py-2 text-sm text-white transition-colors hover:bg-xp-blue-dark focus:outline-none focus:ring-1 focus:ring-xp-blue"
                  aria-label={t('settings.gdrive.ariaRetryUpload')}
                >
                  {t('settings.gdrive.retry')}
                </button>
                <button
                  onClick={handleClose}
                  className="rounded border border-xp-border px-4 py-2 text-sm text-xp-text transition-colors hover:bg-xp-surface-light focus:outline-none focus:ring-1 focus:ring-xp-blue"
                  aria-label={t('settings.gdrive.ariaCancelUpload')}
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
