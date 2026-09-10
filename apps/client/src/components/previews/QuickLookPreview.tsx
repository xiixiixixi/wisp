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

  useEffect(() => {
    const myAttempt = ++attemptRef.current;
    setThumbSrc(null);
    setDocText(null);
    setFailed(false);
    setLoading(true);

    if (!isTauri()) {
      setFailed(true);
      setLoading(false);
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const jobs: Promise<void>[] = [
      TauriAPI.previewQlThumbnail(file.path, 1600)
        .then((thumb) => {
          if (myAttempt !== attemptRef.current) return;
          if (thumb) setThumbSrc(convertAssetUrl(thumb));
          else setFailed(true);
        })
        .catch(() => {
          if (myAttempt === attemptRef.current) setFailed(true);
        }),
    ];
    if (TEXT_EXTRACTABLE.has(ext)) {
      jobs.push(
        TauriAPI.extractDocumentText(file.path)
          .then((text) => {
            if (myAttempt !== attemptRef.current) return;
            if (text && text.trim()) setDocText(text.trim());
          })
          .catch(() => undefined),
      );
    }
    Promise.all(jobs).then(() => {
      if (myAttempt !== attemptRef.current) return;
      setLoading(false);
      onLoad?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[2px] border border-xp-border bg-xp-surface">
          <img src={thumbSrc} alt={file.name} className="max-h-full max-w-full object-contain" />
        </div>
      )}
      {docText && (
        <div className="min-h-0 flex-shrink-0 overflow-auto rounded-[2px] border border-xp-border bg-xp-surface p-2 text-xs leading-relaxed text-xp-text-secondary">
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
