import React from 'react';
import { useTranslation } from 'react-i18next';
import { Calculator, RotateCw } from 'lucide-react';
import type { FileEntry } from '@/lib/tauri-api';
import { dispatchPreviewRotate, getPreviewActionsForFile } from '@/lib/preview-actions';

interface PreviewActionBarProps {
  file: FileEntry | null;
  /** Folder size trigger (#22): fires the existing calculation channel. */
  calculateFolderSize?: (path: string) => void;
}

/**
 * Type-trimmed preview action bar (#22). Finder shows only the actions the
 * selected item supports; the list comes from `getPreviewActionsForFile` so
 * new preview kinds slot in at one place.
 */
const PreviewActionBar = ({ file, calculateFolderSize }: PreviewActionBarProps) => {
  const { t } = useTranslation();
  const actions = getPreviewActionsForFile(file);
  if (actions.length === 0) return null;

  return (
    <div className="mr-auto flex items-center gap-1" role="toolbar" aria-label={t('previewPanel.actionBar')}>
      {actions.includes('rotate') && (
        <button
          type="button"
          data-testid="preview-action-rotate"
          className="wisp-icon-button flex h-7 w-7 items-center justify-center rounded-md text-xp-text-secondary hover:bg-xp-surface-light"
          aria-label={t('previewPanel.rotate')}
          title={t('previewPanel.rotate')}
          onClick={() => dispatchPreviewRotate(file!.path, 90)}
        >
          <RotateCw size={14} aria-hidden="true" />
        </button>
      )}
      {actions.includes('calculate-size') && (
        <button
          type="button"
          data-testid="preview-action-calculate-size"
          className="wisp-icon-button flex h-7 w-7 items-center justify-center rounded-md text-xp-text-secondary hover:bg-xp-surface-light"
          aria-label={t('previewPanel.calculateSize')}
          title={t('previewPanel.calculateSize')}
          onClick={() => calculateFolderSize?.(file!.path)}
        >
          <Calculator size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

export default React.memo(PreviewActionBar);
