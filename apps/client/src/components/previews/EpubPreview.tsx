import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef, useState } from 'react';
import { PreviewProps } from '@/lib/preview-factory';
import { convertAssetUrl, isTauri } from '@/lib/transport';
import { TauriAPI, type EpubChapter } from '@/lib/tauri-api';
import { PreviewSkeleton } from '@/components/ui/Skeleton';
import { ChevronLeft, ChevronRight, BookOpen } from 'lucide-react';

/**
 * EPUB reader: the Rust side unpacks the book into the preview cache and
 * resolves the spine (+ titles from nav.xhtml / toc.ncx); the webview
 * renders each chapter's XHTML in a script-blocked iframe so the book's own
 * stylesheet and images load via the asset protocol.
 */
const EpubPreview = ({ file, onError, onLoad }: PreviewProps) => {
  const { t: tUi } = useTranslation();
  const [baseDir, setBaseDir] = useState<string | null>(null);
  const [chapters, setChapters] = useState<EpubChapter[] | null>(null);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const attemptRef = useRef(0);

  useEffect(() => {
    const myAttempt = ++attemptRef.current;
    setBaseDir(null);
    setChapters(null);
    setIndex(0);
    setFailed(false);
    setLoading(true);

    if (!isTauri()) {
      setFailed(true);
      setLoading(false);
      return;
    }
    TauriAPI.previewEpub(file.path)
      .then((info) => {
        if (myAttempt !== attemptRef.current) return;
        if (info && info.chapters.length > 0) {
          setBaseDir(info.base_dir);
          setChapters(info.chapters);
          onLoad?.();
        } else {
          setFailed(true);
          onError?.(new Error('epub could not be unpacked'));
        }
      })
      .catch((err: unknown) => {
        if (myAttempt !== attemptRef.current) return;
        setFailed(true);
        onError?.(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (myAttempt === attemptRef.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path]);

  if (loading) return <PreviewSkeleton />;

  if (failed || !baseDir || !chapters) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-xp-text-muted">
        <div>
          <BookOpen size={28} className="mx-auto mb-2 opacity-60" aria-hidden />
          {tUi('previewPanel.epubUnavailable')}
        </div>
      </div>
    );
  }

  const chapter = chapters[index];
  const chapterLabel = (c: EpubChapter, i: number) =>
    c.title || tUi('previewPanel.epubChapter', { index: i + 1 });

  return (
    <div className="flex h-full flex-col gap-1.5">
      {/* Chapter navigation — Finder's Quick Look shows the cover page; Wisp
          goes further with the full reading order. */}
      <div className="flex flex-shrink-0 items-center gap-1.5 text-xs text-xp-text-secondary">
        <button
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          aria-label={tUi('previewPanel.epubPrevChapter')}
          className="rounded-[2px] p-1 hover:bg-xp-surface-light disabled:opacity-40"
        >
          <ChevronLeft size={14} aria-hidden />
        </button>
        <select
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
          aria-label={tUi('previewPanel.epubChapterList')}
          className="min-w-0 flex-1 truncate rounded-[2px] border border-xp-border bg-xp-bg px-1.5 py-1 text-xs text-xp-text"
        >
          {chapters.map((c, i) => (
            <option key={`${c.href}-${i}`} value={i}>
              {chapterLabel(c, i)}
            </option>
          ))}
        </select>
        <span className="shrink-0 tabular-nums">
          {index + 1}/{chapters.length}
        </span>
        <button
          onClick={() => setIndex((i) => Math.min(chapters.length - 1, i + 1))}
          disabled={index === chapters.length - 1}
          aria-label={tUi('previewPanel.epubNextChapter')}
          className="rounded-[2px] p-1 hover:bg-xp-surface-light disabled:opacity-40"
        >
          <ChevronRight size={14} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-[2px] border border-xp-border bg-white">
        <iframe
          key={chapter.href}
          title={`${file.name} — ${chapterLabel(chapter, index)}`}
          src={convertAssetUrl(`${baseDir}/${chapter.href}`)}
          sandbox=""
          onLoad={() => onLoad?.()}
          className="h-full w-full border-0 bg-white"
        />
      </div>
    </div>
  );
};

export default React.memo(EpubPreview);
