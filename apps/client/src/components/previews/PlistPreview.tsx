import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef, useState } from 'react';
import { PreviewProps } from '@/lib/preview-factory';
import { TauriAPI } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';
import { WispCodeMirror } from '@/lib/codemirror';
import { PreviewSkeleton } from '@/components/ui/Skeleton';

/**
 * Property-list preview (XML and binary, plus .strings): binary plists are
 * gibberish as raw text, so the Rust bridge converts via `plutil` first —
 * exactly what Finder's Quick Look shows. Falls back to the raw file when
 * plutil refuses (non-plist content with a .plist extension).
 */
const PlistPreview = ({ file, onError, onLoad }: PreviewProps) => {
  const { t: tUi } = useTranslation();
  const [xml, setXml] = useState<string | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const attemptRef = useRef(0);

  useEffect(() => {
    const myAttempt = ++attemptRef.current;
    let cancelled = false;
    setXml(null);
    setRaw(null);
    setFailed(false);
    setLoading(true);

    (async () => {
      if (!isTauri()) {
        setFailed(true);
        setLoading(false);
        return;
      }
      try {
        const converted = await TauriAPI.previewPlistXml(file.path).catch(() => null);
        if (cancelled || myAttempt !== attemptRef.current) return;
        if (converted) {
          setXml(converted);
          setLoading(false);
          onLoad?.();
          return;
        }
        // Already-XML plists also come back fine from plutil, so reaching
        // here means the file is not a plist — show its raw text instead.
        const text = await TauriAPI.readTextFile(file.path).catch(() => null);
        if (cancelled || myAttempt !== attemptRef.current) return;
        if (text) {
          setRaw(text);
          setLoading(false);
          onLoad?.();
        } else {
          setFailed(true);
          setLoading(false);
          onError?.(new Error('Property list could not be read'));
        }
      } catch (err) {
        if (cancelled || myAttempt !== attemptRef.current) return;
        setFailed(true);
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

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-xp-text-muted">
        {tUi('previewPanel.plistReadFailed')}
      </div>
    );
  }

  const doc = xml ?? raw ?? '';
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-xp-border bg-xp-surface">
      <WispCodeMirror
        doc={doc}
        readOnly
        language="xml"
        fileName={file.name}
        ariaLabel={file.name}
        className="min-h-0 flex-1 overflow-auto"
      />
    </div>
  );
};

export default React.memo(PlistPreview);
