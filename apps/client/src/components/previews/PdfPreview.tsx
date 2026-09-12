import { useTranslation } from 'react-i18next';
import React, { useEffect, useState } from 'react';
import { PreviewProps } from '@/lib/preview-factory';
import { mediaUrl } from '@/lib/preview-media';
import { PreviewSkeleton } from '@/components/ui/Skeleton';

/**
 * PDF preview via the webview's native PDF viewer (WKWebView/WebView2 both
 * ship one). The file streams straight from the asset protocol — no pdfjs
 * bundle, no worker, no engine-specific module-eval bugs. Native chrome
 * provides zoom, page nav, and text search.
 */
const PdfPreview = ({ file, onError, onLoad }: PreviewProps) => {
  const { t: tUi } = useTranslation();
  const [src, setSrc] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    // media:// serves ranged requests, so WKWebView's PDF viewer starts
    // rendering immediately instead of buffering the whole file first.
    setSrc(mediaUrl(file.path));
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
            onError={(e) => {
              onError?.(new Error('Failed to load PDF'));
              e.currentTarget.src = src; // let the webview retry once
            }}
            className="h-full w-full border-0"
          />
        )}
      </div>
      <div className="flex-shrink-0 px-1 text-[10px] text-xp-text-muted">
        {file.name} {tUi('interface.useTheViewerSControlsToZoomAndPage')}
      </div>
    </div>
  );
};

export default PdfPreview;
