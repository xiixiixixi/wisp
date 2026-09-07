import { useTranslation } from 'react-i18next';
import { Copy, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { FileEntry } from '@/lib/tauri-api';
import { formatFileSize, getFileIcon } from '@/lib/utils';

/** Read-only properties of the exact selection, rather than its first item. */
export default function SelectionPropertiesDialog({
  files,
  onClose,
  onCopyPaths,
}: {
  files: FileEntry[];
  onClose: () => void;
  onCopyPaths: () => void;
}) {
  const { t } = useTranslation();
  const folders = files.filter((file) => file.is_dir).length;
  const bytes = files.reduce((sum, file) => sum + (file.is_dir ? 0 : file.size), 0);
  return (
    <Dialog
      open={files.length > 1}
      maxWidth="32rem"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <DialogTitle>{t('selectionProperties.title', { count: files.length })}</DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={onClose}
              aria-label={t('common.close')}
            >
              <X size={18} />
            </Button>
          </div>
          <p className="text-sm text-xp-text-secondary">
            {t('selectionProperties.summary', { files: files.length - folders, folders })}
          </p>
        </DialogHeader>
        <div className="my-4 flex items-baseline justify-between gap-4 text-sm">
          <span className="text-xp-text-secondary">{t('selectionProperties.fileBytes')}</span>
          <span className="font-semibold tabular-nums">{formatFileSize(bytes)}</span>
        </div>
        <ul
          className="max-h-72 overflow-y-auto"
          tabIndex={0}
          aria-label={t('selectionProperties.items')}
        >
          {files.map((file) => (
            <li key={file.path} className="flex items-center gap-3 border-t border-xp-border py-3">
              <span className="shrink-0" aria-hidden="true">
                {getFileIcon(file)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-all text-sm font-medium">{file.name}</p>
                <p className="mt-1 select-text break-all text-xs text-xp-text-secondary">
                  {file.path}
                </p>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-xp-text-secondary">
                {file.is_dir ? t('common.folder') : formatFileSize(file.size)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end">
          <Button variant="outline" onClick={onCopyPaths}>
            <Copy size={15} />
            {t('selectionProperties.copyPaths')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
