import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef, useState } from 'react';
import { PreviewProps } from '@/lib/preview-factory';
import { convertAssetUrl, isTauri } from '@/lib/transport';
import { TauriAPI } from '@/lib/tauri-api';
import { PreviewSkeleton } from '@/components/ui/Skeleton';

/** Formats whose text the Rust document extractor can also pull. */
const TEXT_EXTRACTABLE = new Set(['ppt', 'pptx', 'pps', 'ppsx']);

/**
 * Catch-all for formats with no web renderer but full Finder Quick Look
 * support (PowerPoint, USDZ, ICC profiles, …): the Rust bridge asks the
 * Quick Look engine itself for a first-page thumbnail. Presentation files
 * additionally show the extracted slide text below, so the content — not
 * just the cover — is readable.
 */
const QuickLookPreview = ({ file, onError, onLoad }: PreviewProps) => {
  const { t: tUi } = useTranslation();
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const [docText, setDocText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const attemptRef = useRef(0);
  const callbacksRef = useRef({ onError, onLoad });
  callbacksRef.current = { onError, onLoad };

  useEffect(() => {
    const myAttempt = ++attemptRef.current;
    const cancelAttempt = () => {
      attemptRef.current += 1;
    };
    setThumbSrc(null);
    setDocText(null);
    setFailed(false);
    setLoading(true);

    if (!isTauri()) {
      setFailed(true);
      setLoading(false);
      callbacksRef.current.onError?.(
        new Error('Native Quick Look preview is unavailable in the browser'),
      );
      return cancelAttempt;
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const thumbnail = TauriAPI.previewQlThumbnail(file.path, 1600)
      .then((thumb) => (thumb ? convertAssetUrl(thumb) : null))
      .catch(() => null);
    const extractedText = TEXT_EXTRACTABLE.has(ext)
      ? TauriAPI.extractDocumentText(file.path)
          .then((text) => text?.trim() || null)
          .catch(() => null)
      : Promise.resolve(null);

    void Promise.all([thumbnail, extractedText]).then(([thumb, text]) => {
      if (myAttempt !== attemptRef.current) return;
      setThumbSrc(thumb);
      setDocText(text);
      setLoading(false);
      if (thumb || text) {
        callbacksRef.current.onLoad?.();
      } else {
        setFailed(true);
        callbacksRef.current.onError?.(new Error('Quick Look could not render this file'));
      }
    });
    return cancelAttempt;
  }, [file.path, file.name]);

  if (loading) return <PreviewSkeleton />;

  if (!thumbSrc && !docText) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-xp-text-muted">
        {failed ? tUi('previewPanel.qlThumbnailFailed') : tUi('previewPanel.noEmbeddedPreview')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-1.5">
      {thumbSrc && (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-xp-border bg-xp-surface">
          <img src={thumbSrc} alt={file.name} className="max-h-full max-w-full object-contain" />
        </div>
      )}
      {docText && (
        <div className="min-h-0 flex-shrink-0 overflow-auto rounded-md border border-xp-border bg-xp-surface p-2 text-xs leading-relaxed text-xp-text-secondary">
          <div className="mb-1 text-[10px] uppercase text-xp-text-muted">
            {tUi('previewPanel.extractedText')}
          </div>
          <pre className="whitespace-pre-wrap break-words font-sans">{docText}</pre>
        </div>
      )}
      {(thumbSrc || docText) && (
        <div className="flex-shrink-0 px-1 text-[10px] text-xp-text-muted">
          {file.name} · {tUi('previewPanel.firstPageOnly')}
        </div>
      )}
    </div>
  );
};

export default React.memo(QuickLookPreview);
