import { useTranslation } from 'react-i18next';
import React, { useEffect, useState } from 'react';
import { PreviewProps } from '@/lib/preview-factory';
import { mediaUrl } from '@/lib/preview-media';
import { PreviewSkeleton } from '@/components/ui/Skeleton';
import { isTauri } from '@/lib/transport';
import { isMacPlatform } from '@/lib/shortcut-utils';
import NativeFilePreview from './NativeFilePreview';

/**
 * Other platforms retain the browser's PDF support. macOS uses a native
 * document view below, without WebKit's built-in floating PDF toolbar.
 */
const BrowserPdfPreview = ({ file, onError, onLoad }: PreviewProps) => {
  const [src, setSrc] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    // media:// serves ranged requests, so WKWebView's PDF viewer starts
    // rendering immediately instead of buffering the whole file first.
    setSrc(`${mediaUrl(file.path)}#toolbar=0&navpanes=0&scrollbar=0`);
  }, [file.path]);

  return (
    <div className="flex h-full flex-col gap-1.5">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-xp-border bg-xp-surface">
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center">
            <PreviewSkeleton />
          </div>
        )}
        {src && (
          <iframe
            title={file.name}
            src={src}
            onLoad={() => {
              setReady(true);
              onLoad?.();
            }}
            onError={() => {
              onError?.(new Error('Failed to load PDF'));
            }}
            className="h-full w-full border-0"
          />
        )}
      </div>
    </div>
  );
};

const NativePdfUnavailable = ({ onError }: PreviewProps) => {
  const { t } = useTranslation();
  useEffect(() => {
    // The parent supplies retry/open actions. Do not silently restore the
    // browser PDF plugin (and its floating toolbar) on a native load failure.
    onError?.(new Error('Failed to load PDF'));
  }, [onError]);
  return (
    <div className="flex h-full items-center justify-center p-4 text-sm text-xp-text-secondary">
      {t('previewPanel.unavailable.failedTitle')}
    </div>
  );
};

const PdfPreview = (props: PreviewProps) => {
  if (isTauri() && isMacPlatform()) {
    return (
      <NativeFilePreview key={props.file.path} {...props}>
        <NativePdfUnavailable {...props} />
      </NativeFilePreview>
    );
  }
  return <BrowserPdfPreview key={props.file.path} {...props} />;
};

export default PdfPreview;
