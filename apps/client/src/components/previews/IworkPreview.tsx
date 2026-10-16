import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef, useState } from 'react';
import { PreviewProps } from '@/lib/preview-factory';
import { convertAssetUrl, isTauri } from '@/lib/transport';
import { mediaUrl } from '@/lib/preview-media';
import { TauriAPI } from '@/lib/tauri-api';
import { PreviewSkeleton } from '@/components/ui/Skeleton';

/**
 * iWork preview (Pages/Numbers/Keynote): every iWork bundle ships a
 * QuickLook/Preview.pdf for exactly this purpose — the Rust side extracts it
 * and the webview's native PDF viewer renders the full multi-page document,
 * the same content Finder's Quick Look shows. Older/public-domain files
 * without the embedded PDF fall back to a Quick Look thumbnail.
 */
const IworkPreview = ({ file, onError, onLoad }: PreviewProps) => {
  const { t: tUi } = useTranslation();
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const attemptRef = useRef(0);

  useEffect(() => {
    const myAttempt = ++attemptRef.current;
    let cancelled = false;
    setPdfPath(null);
    setThumbSrc(null);
    setLoading(true);

    (async () => {
      if (!isTauri()) {
        setLoading(false);
        return;
      }
      try {
        const pdf = await TauriAPI.previewIworkPdf(file.path).catch(() => null);
        if (cancelled || myAttempt !== attemptRef.current) return;
        if (pdf) {
          setPdfPath(pdf);
          setLoading(false);
          return;
        }
        // No embedded preview — render the document thumbnail instead.
        const thumb = await TauriAPI.previewQlThumbnail(file.path, 1600).catch(() => null);
        if (cancelled || myAttempt !== attemptRef.current) return;
        if (thumb) {
          setThumbSrc(convertAssetUrl(thumb));
          setLoading(false);
          onLoad?.();
        } else {
          setLoading(false);
          onError?.(new Error('iWork document has no embedded QuickLook preview'));
        }
      } catch (err) {
        if (cancelled || myAttempt !== attemptRef.current) return;
        setLoading(false);
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path]);

  if (loading) return <PreviewSkeleton />;

  if (pdfPath) {
    return (
      <div className="flex h-full flex-col gap-1.5">
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-xp-border bg-xp-surface">
          <iframe
            title={file.name}
            src={mediaUrl(pdfPath)}
            onLoad={() => onLoad?.()}
            className="h-full w-full border-0"
          />
        </div>
        <div className="flex-shrink-0 px-1 text-[10px] text-xp-text-muted">
          {file.name} {tUi('interface.useTheViewerSControlsToZoomAndPage')}
        </div>
      </div>
    );
  }

  if (thumbSrc) {
    return (
      <div className="flex h-full flex-col gap-1.5">
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-xp-border bg-xp-surface">
          <img src={thumbSrc} alt={file.name} className="max-h-full max-w-full object-contain" />
        </div>
        <div className="flex-shrink-0 px-1 text-[10px] text-xp-text-muted">
          {file.name} · {tUi('previewPanel.firstPageOnly')}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center text-center text-sm text-xp-text-muted">
      {tUi('previewPanel.noEmbeddedPreview')}
    </div>
  );
};

export default React.memo(IworkPreview);
