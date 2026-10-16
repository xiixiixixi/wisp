import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef, useState } from 'react';
import { PreviewProps } from '@/lib/preview-factory';
import { TauriAPI } from '@/lib/tauri-api';
import type { ArchiveInfo } from '@/lib/tauri-api-types';
import { formatFileSize, formatDate } from '@/lib/utils';
import { PreviewSkeleton } from '@/components/ui/Skeleton';
import { File, Folder } from 'lucide-react';

const MAX_RENDERED_ENTRIES = 500;

/**
 * Archive listing — Finder's Quick Look for .zip shows the item list, so
 * Wisp does too. Reads only the central directory via get_archive_info, so
 * multi-GB archives list instantly.
 */
const ArchivePreview = ({ file, onError, onLoad }: PreviewProps) => {
  const { t: tUi } = useTranslation();
  const [info, setInfo] = useState<ArchiveInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    const myAttempt = ++attemptRef.current;
    setInfo(null);
    setError(null);
    setLoading(true);

    TauriAPI.getArchiveInfo(file.path)
      .then((result) => {
        if (myAttempt !== attemptRef.current) return;
        setInfo(result);
        setLoading(false);
        onLoad?.();
      })
      .catch((err: unknown) => {
        if (myAttempt !== attemptRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setLoading(false);
        onError?.(err instanceof Error ? err : new Error(message));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path]);

  if (loading) return <PreviewSkeleton />;

  if (error || !info) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-xp-border bg-xp-surface p-4 text-center text-sm text-xp-text-muted">
        {tUi('previewPanel.archiveReadFailed')}
      </div>
    );
  }

  const entries = [...info.files].sort((a, b) => a.path.localeCompare(b.path));
  const shown = entries.slice(0, MAX_RENDERED_ENTRIES);
  const hidden = entries.length - shown.length;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-xp-border bg-xp-surface">
      {/* Summary — mirrors the Quick Look header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-xp-border px-3 py-2 text-xs text-xp-text-secondary">
        <span>
          {tUi('previewPanel.archiveItems', {
            count: info.total_files + info.total_directories,
          })}
        </span>
        <span>
          {tUi('previewPanel.archiveUnpacked', { size: formatFileSize(info.total_size) })}
        </span>
        {info.is_encrypted && (
          <span className="text-amber-600">{tUi('previewPanel.archiveEncrypted')}</span>
        )}
      </div>

      {/* Entry table */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-xp-surface text-[10px] uppercase text-xp-text-muted">
            <tr>
              <th className="px-3 py-1.5 font-semibold">{tUi('previewPanel.archiveName')}</th>
              <th className="px-2 py-1.5 text-right font-semibold">{tUi('interface.sizeLabel')}</th>
              <th className="px-2 py-1.5 text-right font-semibold">
                {tUi('previewPanel.archiveCompressed')}
              </th>
              <th className="px-3 py-1.5 text-right font-semibold">
                {tUi('interface.modifiedLabel')}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((entry, i) => (
              <tr key={`${entry.path}-${i}`} className="border-xp-border/50 border-t text-xp-text">
                <td className="max-w-0 truncate px-3 py-1" title={entry.path}>
                  <span className="inline-flex items-center gap-1.5">
                    {entry.is_directory ? (
                      <Folder size={13} className="shrink-0 text-xp-text-muted" aria-hidden />
                    ) : (
                      <File size={13} className="shrink-0 text-xp-text-muted" aria-hidden />
                    )}
                    <span className="truncate">{entry.path}</span>
                  </span>
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-xp-text-secondary">
                  {entry.is_directory ? '—' : formatFileSize(entry.size)}
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums text-xp-text-muted">
                  {entry.is_directory ? '—' : formatFileSize(entry.compressed_size)}
                </td>
                <td className="whitespace-nowrap px-3 py-1 text-right tabular-nums text-xp-text-muted">
                  {entry.modified ? formatDate(entry.modified) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {hidden > 0 && (
          <div className="border-xp-border/50 border-t px-3 py-2 text-center text-[11px] text-xp-text-muted">
            {tUi('previewPanel.archiveMore', { count: hidden })}
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(ArchivePreview);
