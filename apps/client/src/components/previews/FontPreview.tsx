import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef, useState } from 'react';
import { PreviewProps } from '@/lib/preview-factory';
import { convertAssetUrl, isTauri } from '@/lib/transport';
import { TauriAPI } from '@/lib/tauri-api';
import { PreviewSkeleton } from '@/components/ui/Skeleton';

const LATIN_SAMPLE = 'The quick brown fox jumps over the lazy dog';
const DIGITS_SAMPLE = '0123456789 · ⅓ ½ ¾ × ÷ © ® ™';
const CHAR_GRID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n0123456789 ?!&@#';

/**
 * Font specimen (TTF/OTF/TTC/WOFF/…): load the bytes through the FontFace
 * API and render sample text at several sizes — the same idea as Finder's
 * font preview. Collection formats WebKit cannot open fall back to a Quick
 * Look thumbnail.
 */
const FontPreview = ({ file, onError, onLoad }: PreviewProps) => {
  const { t: tUi } = useTranslation();
  const [family, setFamily] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [thumbSrc, setThumbSrc] = useState<string | null>(null);
  const faceRef = useRef<FontFace | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    const myAttempt = ++attemptRef.current;
    let cancelled = false;
    setFamily(null);
    setFailed(false);
    setThumbSrc(null);
    setLoading(true);

    const load = async () => {
      if (!isTauri()) {
        setFailed(true);
        setLoading(false);
        return;
      }
      try {
        const bytes = await TauriAPI.readBinaryFile(file.path);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const face = new FontFace('WispFontPreview', buffer as ArrayBuffer);
        await face.load();
        if (cancelled || myAttempt !== attemptRef.current) {
          document.fonts.delete(face);
          return;
        }
        document.fonts.add(face);
        faceRef.current = face;
        setFamily('WispFontPreview');
        setLoading(false);
        onLoad?.();
      } catch {
        // TTC/dfont and exotic collections cannot load via FontFace — let
        // Quick Look render its specimen instead.
        if (cancelled || myAttempt !== attemptRef.current) return;
        const thumb = await TauriAPI.previewQlThumbnail(file.path, 1024).catch(() => null);
        if (cancelled || myAttempt !== attemptRef.current) return;
        if (thumb) {
          setThumbSrc(convertAssetUrl(thumb));
          setLoading(false);
          onLoad?.();
        } else {
          setFailed(true);
          setLoading(false);
          onError?.(new Error('Font could not be loaded'));
        }
      }
    };

    load();
    return () => {
      cancelled = true;
      if (faceRef.current) {
        document.fonts.delete(faceRef.current);
        faceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path]);

  if (loading) return <PreviewSkeleton />;

  if (family) {
    return (
      <div className="h-full overflow-auto rounded-[2px] border border-xp-border bg-xp-surface p-4">
        <h3 className="mb-1 truncate text-sm font-medium text-xp-text" title={file.name}>
          {file.name}
        </h3>
        <p className="mb-4 text-xs text-xp-text-muted">{tUi('previewPanel.fontSpecimen')}</p>
        <div style={{ fontFamily: family }} className="space-y-5 text-xp-text">
          {[48, 32, 24, 18, 14].map((size) => (
            <div key={size} className="flex items-baseline gap-3">
              <span className="w-8 shrink-0 text-[10px] tabular-nums text-xp-text-muted">
                {size}
              </span>
              <div className="min-w-0 break-words leading-snug" style={{ fontSize: size }}>
                {LATIN_SAMPLE}
              </div>
            </div>
          ))}
          <div className="border-t border-xp-border pt-4">
            <div className="mb-3 text-[10px] text-xp-text-muted">{DIGITS_SAMPLE}</div>
            <pre className="whitespace-pre font-inherit leading-loose">{CHAR_GRID}</pre>
          </div>
        </div>
      </div>
    );
  }

  if (thumbSrc) {
    return (
      <div className="flex h-full flex-col gap-1.5">
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[2px] border border-xp-border bg-xp-surface">
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
      {tUi('previewPanel.fontLoadFailed')}
    </div>
  );
};

export default React.memo(FontPreview);
