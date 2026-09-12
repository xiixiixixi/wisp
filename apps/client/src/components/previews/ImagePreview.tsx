import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef, useState } from 'react';
import { PreviewProps } from '@/lib/preview-factory';
import { convertAssetUrl, isTauri } from '@/lib/transport';
import { TauriAPI } from '@/lib/tauri-api';
import { PreviewSkeleton } from '@/components/ui/Skeleton';

// Formats WebKit renders natively. Anything else (HEIC on older WebKit, RAW,
// PSD, …) goes through the Rust ImageIO bridge after the native attempt
// fails — one failed <img> load, then a converted JPEG.
const NATIVE_IMAGE_EXTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'bmp',
  'webp',
  'svg',
  'svgz',
  'ico',
  'tiff',
  'tif',
  'avif',
  'heic', // WebKit ≥17 renders HEIC natively; bridge covers the rest
  'heif',
]);

const ImagePreview = ({ file, onError, onLoad }: PreviewProps) => {
  const { t: tUi } = useTranslation();
  const [imageError, setImageError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [imageSrc, setImageSrc] = useState<string>('');
  // Native attempt failed → try the Rust conversion bridge exactly once.
  const [bridgeAttempted, setBridgeAttempted] = useState(false);
  const attemptRef = useRef(0);

  useEffect(() => {
    // Reset states when file changes
    setLoading(true);
    setImageError(false);
    setBridgeAttempted(false);
    attemptRef.current += 1;

    // Convert file path to Tauri asset URL
    setImageSrc(convertAssetUrl(file.path));
  }, [file.path]);

  const handleImageLoad = () => {
    setLoading(false);
    onLoad?.();
  };

  const handleImageError = async () => {
    if (bridgeAttempted || !isTauri()) {
      setImageError(true);
      setLoading(false);
      onError?.(new Error('Failed to load image'));
      return;
    }
    // WebKit could not decode it (RAW/PSD/exotic) — ask ImageIO for a JPEG.
    const myAttempt = ++attemptRef.current;
    setBridgeAttempted(true);
    try {
      const converted = await TauriAPI.previewConvertImage(file.path, 2048);
      if (myAttempt !== attemptRef.current) return; // file changed meanwhile
      if (converted) {
        setImageSrc(convertAssetUrl(converted));
        return; // wait for the converted <img> load/error
      }
    } catch {
      // fall through to error state
    }
    setImageError(true);
    setLoading(false);
    onError?.(new Error('Failed to load image'));
  };

  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const native = NATIVE_IMAGE_EXTS.has(ext) || file.mime_type?.startsWith('image/');

  return (
    <div className="flex h-full flex-col">
      {loading && <PreviewSkeleton />}
      {!imageError && (
        <div
          className={`flex flex-1 items-center justify-center overflow-hidden rounded-md border border-xp-border bg-xp-surface ${loading ? 'hidden' : ''}`}
        >
          <img
            src={imageSrc}
            alt={file.name}
            className="max-h-full max-w-full object-contain"
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
        </div>
      )}
      {imageError && (
        <div className="flex flex-1 items-center justify-center rounded-md border border-xp-border bg-xp-surface">
          <div className="text-center text-xp-text-muted">
            <svg className="mx-auto mb-2 h-12 w-12" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
                clipRule="evenodd"
              />
            </svg>
            <p className="text-sm">{tUi('interface.cannotPreviewImage')}</p>
            <p className="mt-1 text-xs opacity-70">
              {tUi('interface.theImageFormatMayNotBeSupported')}
            </p>
          </div>
        </div>
      )}
      {!imageError && !native && (
        <div className="flex-shrink-0 px-1 pt-1 text-[10px] text-xp-text-muted">
          {file.name} · {tUi('previewPanel.convertedPreview')}
        </div>
      )}
    </div>
  );
};

export default React.memo(ImagePreview);
