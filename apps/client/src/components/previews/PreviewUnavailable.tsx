import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Info, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';
import { getFileIcon } from '@/lib/utils';
import '@/styles/preview-fallback.css';

export type PreviewUnavailableReason = 'unsupported' | 'too-large' | 'failed';

interface PreviewUnavailableProps {
  file: FileEntry;
  reason: PreviewUnavailableReason;
  onShowDetails: () => void;
  onRetry?: () => void;
}

const PreviewUnavailable = ({ file, reason, onShowDetails, onRetry }: PreviewUnavailableProps) => {
  const { t } = useTranslation();
  const id = useId();
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const requestRef = useRef(0);
  const desktop = isTauri();
  const dot = file.name.lastIndexOf('.');
  const extension = dot > 0 && dot < file.name.length - 1 ? file.name.slice(dot + 1) : '';
  const typeLabel = extension
    ? t('previewPanel.unavailable.fileType', {
        extension: extension.toUpperCase(),
        defaultValue: '{{extension}} file',
      })
    : file.mime_type || t('fileType.File', { defaultValue: 'File' });

  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );

  const openDefault = async () => {
    if (!desktop || opening) return;
    const request = ++requestRef.current;
    setOpening(true);
    setOpenFailed(false);
    try {
      await TauriAPI.openFile(file.path);
    } catch {
      if (requestRef.current === request) setOpenFailed(true);
    } finally {
      if (requestRef.current === request) setOpening(false);
    }
  };

  const messages = {
    unsupported: {
      title: t('previewPanel.unavailable.unsupportedTitle', {
        defaultValue: 'Preview unavailable',
      }),
      description: t('previewPanel.unavailable.unsupportedDescription', {
        defaultValue:
          'Wisp does not have a preview for this file. You can open it in its default application or view its details.',
      }),
    },
    'too-large': {
      title: t('previewPanel.unavailable.tooLargeTitle', {
        defaultValue: 'File too large for sidebar preview',
      }),
      description: t('previewPanel.unavailable.tooLargeDescription', {
        defaultValue:
          'This file is too large to load in the sidebar. Open it in its default application or view its details.',
      }),
    },
    failed: {
      title: t('previewPanel.unavailable.failedTitle', { defaultValue: 'Couldn’t load preview' }),
      description: t('previewPanel.unavailable.failedDescription', {
        defaultValue:
          'The preview could not be loaded. Try again, or open the file in its default application.',
      }),
    },
  };
  const message = messages[reason];

  return (
    <section className="wisp-preview-unavailable" aria-labelledby={`${id}-name`}>
      <div className="wisp-preview-unavailable-content">
        <div className="wisp-preview-file-icon" aria-hidden="true">
          {getFileIcon(file)}
        </div>
        <h3 id={`${id}-name`} className="wisp-preview-unavailable-name" title={file.path}>
          {file.name}
        </h3>
        <p className="wisp-preview-unavailable-type">{typeLabel}</p>
        <div className="wisp-preview-unavailable-reason" role="status">
          <h4>{message.title}</h4>
          <p>{message.description}</p>
        </div>
        <div className="wisp-preview-unavailable-actions">
          <Button
            onClick={() => void openDefault()}
            disabled={!desktop || opening}
            aria-describedby={!desktop ? `${id}-desktop` : undefined}
          >
            <ExternalLink size={14} aria-hidden="true" />
            {opening
              ? t('previewPanel.unavailable.opening', { defaultValue: 'Opening…' })
              : t('previewPanel.unavailable.openDefault', { defaultValue: 'Open in Default App' })}
          </Button>
          <div className="wisp-preview-unavailable-secondary">
            <Button variant="secondary" onClick={onShowDetails}>
              <Info size={14} aria-hidden="true" />
              {t('previewPanel.unavailable.showDetails', { defaultValue: 'Show Details' })}
            </Button>
            {reason === 'failed' && onRetry && (
              <Button variant="secondary" onClick={onRetry}>
                <RotateCw size={14} aria-hidden="true" />
                {t('previewPanel.unavailable.retry', { defaultValue: 'Retry Preview' })}
              </Button>
            )}
          </div>
        </div>
        {!desktop && (
          <p id={`${id}-desktop`} className="wisp-preview-unavailable-feedback">
            {t('previewPanel.unavailable.desktopOnly', {
              defaultValue: 'Use Wisp for desktop to open this file in its default application.',
            })}
          </p>
        )}
        {openFailed && (
          <p className="wisp-preview-unavailable-feedback" role="alert">
            {t('previewPanel.unavailable.openFailed', {
              defaultValue:
                'Couldn’t open this file. Check that it is still available and that a default application is installed.',
            })}
          </p>
        )}
      </div>
    </section>
  );
};

export default PreviewUnavailable;
