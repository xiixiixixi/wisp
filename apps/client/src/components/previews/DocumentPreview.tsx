import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { PreviewProps } from '@/lib/preview-factory';
import { TauriAPI } from '@/lib/tauri-api';
import { convertAssetUrl, isTauri } from '@/lib/transport';
import { PreviewSkeleton } from '@/components/ui/Skeleton';
import { previewErrorText } from '@/lib/preview-error';

type MammothModule = typeof import('mammoth');

/**
 * Word/RichText document preview, Finder-parity pipeline:
 * 1. Rust bridge runs macOS `textutil` (NSAttributedString) → HTML with the
 *    document's formatting; rendered in a script-blocked sandboxed iframe so
 *    inline images extracted next to the HTML load via the asset protocol.
 * 2. .docx falls back to mammoth (semantic HTML) when textutil is unavailable
 *    (non-macOS) or the conversion fails.
 */
const DocumentPreview = ({ file, onError, onLoad }: PreviewProps) => {
  const { t: tUi } = useTranslation();
  const [htmlPath, setHtmlPath] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    const myAttempt = ++attemptRef.current;
    const loadDocument = async () => {
      try {
        setLoading(true);
        setError(null);
        setHtmlPath(null);
        setHtmlContent('');

        // 1. Native macOS conversion — the same engine Quick Look renders with.
        if (isTauri()) {
          const converted = await TauriAPI.previewDocHtml(file.path).catch(() => null);
          if (myAttempt !== attemptRef.current) return;
          if (converted) {
            setHtmlPath(converted);
            setLoading(false);
            onLoad?.();
            return;
          }
        }

        // 2. mammoth fallback for .docx only.
        if (file.name.toLowerCase().endsWith('.docx')) {
          const uint8Array = await TauriAPI.readBinaryFile(file.path);
          if (myAttempt !== attemptRef.current) return;
          const arrayBuffer = uint8Array.buffer.slice(0) as ArrayBuffer;
          const mammoth: MammothModule = await import('mammoth');
          if (myAttempt !== attemptRef.current) return;
          const result = await mammoth.convertToHtml({ arrayBuffer });
          if (myAttempt !== attemptRef.current) return;
          setHtmlContent(
            DOMPurify.sanitize(result.value, {
              FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
              FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
              ALLOW_DATA_ATTR: false,
              ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|data:image\/):/i,
            }),
          );
          if (result.messages.length > 0) {
            console.warn('Document conversion warnings:', result.messages);
          }
          setLoading(false);
          onLoad?.();
          return;
        }

        const errorMessage = tUi('previewPanel.docConvertFailed');
        setError(errorMessage);
        setLoading(false);
        onError?.(new Error(errorMessage));
      } catch (err) {
        if (myAttempt !== attemptRef.current) return;
        const errorMessage = err instanceof Error ? err.message : 'Failed to load document';
        setError(errorMessage);
        setLoading(false);
        onError?.(err instanceof Error ? err : new Error(errorMessage));
      }
    };

    void loadDocument();
    return () => {
      attemptRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, file.name]);

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <PreviewSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-xp-border bg-xp-surface p-4 text-center">
        <div className="text-xp-text-muted">
          <p className="text-sm">{tUi('interface.cannotPreviewDocument')}</p>
          <p className="mt-1 text-xs opacity-70">{previewErrorText(error, tUi)}</p>
        </div>
      </div>
    );
  }

  if (htmlPath) {
    return (
      <div className="flex h-full flex-col gap-1.5">
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-xp-border bg-white">
          <iframe
            title={file.name}
            src={convertAssetUrl(htmlPath)}
            sandbox=""
            onLoad={() => onLoad?.()}
            className="h-full w-full border-0 bg-white"
          />
        </div>
        <div className="flex-shrink-0 px-1 text-[10px] text-xp-text-muted">{file.name}</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto rounded-md border border-xp-border bg-xp-surface p-4">
      <h4 className="mb-2 text-xs font-semibold text-xp-text-muted">
        {tUi('interface.documentPreview')}
      </h4>
      <div
        className="doc-preview-content text-sm leading-relaxed text-xp-text"
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    </div>
  );
};

export default React.memo(DocumentPreview);
