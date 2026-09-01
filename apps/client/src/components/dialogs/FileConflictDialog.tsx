import { useEffect, useRef } from 'react';
import { AlertTriangle, FileIcon, FolderClosed, Replace, Copy, X, ArrowRight } from 'lucide-react';
import type { ConflictFileInfo } from '@/lib/tauri-api';

export type ConflictResolution = 'replace' | 'keep-both' | 'skip';
export type ConflictApplyTo = 'single' | 'all';

interface FileConflictDialogProps {
  isOpen: boolean;
  fileName: string;
  isDir: boolean;
  destination: string;
  remaining: number;
  sourceInfo?: ConflictFileInfo | null;
  destInfo?: ConflictFileInfo | null;
  onResolve: (resolution: ConflictResolution, applyToAll: boolean) => void;
}

const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const formatDate = (epoch: number): string => {
  if (!epoch) return 'Unknown';
  const d = new Date(epoch * 1000);
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const MetadataRow = ({
  label,
  sourceVal,
  destVal,
  highlight,
}: {
  label: string;
  sourceVal: string;
  destVal: string;
  highlight?: 'source' | 'dest' | null;
}) => {
  return (
    <div className="grid grid-cols-[80px_1fr_20px_1fr] items-center gap-1 text-xs">
      <span className="text-xp-text-muted">{label}</span>
      <span
        className={`truncate ${highlight === 'source' ? 'font-medium text-xp-green' : 'text-xp-text'}`}
      >
        {sourceVal}
      </span>
      <ArrowRight className="mx-auto h-3 w-3 text-xp-text-muted" />
      <span
        className={`truncate ${highlight === 'dest' ? 'font-medium text-xp-green' : 'text-xp-text'}`}
      >
        {destVal}
      </span>
    </div>
  );
};

export const FileConflictDialog = ({
  isOpen,
  fileName,
  isDir,
  destination: _destination,
  remaining,
  sourceInfo,
  destInfo,
  onResolve,
}: FileConflictDialogProps) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const hasMetadata = sourceInfo && destInfo;
  let sizeHighlight: 'source' | 'dest' | null = null;
  let dateHighlight: 'source' | 'dest' | null = null;

  if (hasMetadata) {
    if (sourceInfo.size > destInfo.size) sizeHighlight = 'source';
    else if (destInfo.size > sourceInfo.size) sizeHighlight = 'dest';

    if (sourceInfo.modified > destInfo.modified) dateHighlight = 'source';
    else if (destInfo.modified > sourceInfo.modified) dateHighlight = 'dest';
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-labelledby="conflict-title"
        aria-modal="true"
        tabIndex={-1}
        className="w-[480px] max-w-[90vw] rounded-[2px] border border-xp-border bg-xp-surface p-6 outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onResolve('skip', false);
        }}
      >
        {/* Header */}
        <div className="mb-4 flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-6 w-6 flex-shrink-0 text-xp-yellow" />
          <div>
            <h3 id="conflict-title" className="text-base font-semibold text-xp-text">
              File Conflict
            </h3>
            <p className="mt-1 text-sm text-xp-text-muted">
              The destination already has a {isDir ? 'folder' : 'file'} named:
            </p>
          </div>
        </div>

        {/* File name */}
        <div className="mb-3 flex items-center gap-2 rounded-[2px] border border-xp-border bg-xp-surface-light px-3 py-2.5">
          {isDir ? (
            <FolderClosed className="h-5 w-5 flex-shrink-0 text-xp-blue" />
          ) : (
            <FileIcon className="h-5 w-5 flex-shrink-0 text-xp-text-muted" />
          )}
          <span className="truncate text-sm font-medium text-xp-text">{fileName}</span>
        </div>

        {/* Metadata comparison */}
        {hasMetadata && (
          <div className="mb-4 space-y-1.5 rounded-[2px] border border-xp-border bg-xp-surface-light px-3 py-2.5">
            <div className="mb-1 grid grid-cols-[80px_1fr_20px_1fr] items-center gap-1 text-xs font-medium text-xp-text-muted">
              <span />
              <span>Source</span>
              <span />
              <span>Existing</span>
            </div>
            <MetadataRow
              label="Size"
              sourceVal={formatSize(sourceInfo.size)}
              destVal={formatSize(destInfo.size)}
              highlight={sizeHighlight}
            />
            <MetadataRow
              label="Modified"
              sourceVal={formatDate(sourceInfo.modified)}
              destVal={formatDate(destInfo.modified)}
              highlight={dateHighlight}
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => onResolve('replace', false)}
            className="flex w-full items-center gap-3 rounded-[2px] border border-xp-border bg-xp-surface-light px-4 py-2.5 text-left text-sm transition-colors hover:border-xp-red/40 hover:bg-xp-red/15"
            aria-label="Replace existing file"
          >
            <Replace className="h-4 w-4 flex-shrink-0 text-xp-red" />
            <div>
              <div className="font-medium text-xp-text">Replace</div>
              <div className="text-xs text-xp-text-muted">
                Overwrite the existing {isDir ? 'folder' : 'file'}
              </div>
            </div>
          </button>

          <button
            onClick={() => onResolve('keep-both', false)}
            className="flex w-full items-center gap-3 rounded-[2px] border border-xp-border bg-xp-surface-light px-4 py-2.5 text-left text-sm transition-colors hover:border-xp-blue/40 hover:bg-xp-blue/15"
            aria-label="Keep both files"
          >
            <Copy className="h-4 w-4 flex-shrink-0 text-xp-blue" />
            <div>
              <div className="font-medium text-xp-text">Keep Both</div>
              <div className="text-xs text-xp-text-muted">
                Save with a renamed copy (e.g. &quot;{getKeepBothName(fileName)}&quot;)
              </div>
            </div>
          </button>

          <button
            onClick={() => onResolve('skip', false)}
            className="flex w-full items-center gap-3 rounded-[2px] border border-xp-border bg-xp-surface-light px-4 py-2.5 text-left text-sm transition-colors hover:bg-xp-surface"
            aria-label="Skip this file"
          >
            <X className="h-4 w-4 flex-shrink-0 text-xp-text-muted" />
            <div>
              <div className="font-medium text-xp-text">Skip</div>
              <div className="text-xs text-xp-text-muted">
                Don&apos;t paste this {isDir ? 'folder' : 'file'}
              </div>
            </div>
          </button>
        </div>

        {/* Apply to all -- only show when there are more conflicts */}
        {remaining > 0 && (
          <div className="mt-4 border-t border-xp-border pt-3">
            <p className="mb-2 text-xs text-xp-text-muted">
              {remaining} more conflict{remaining > 1 ? 's' : ''} remaining
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => onResolve('replace', true)}
                className="flex-1 rounded-[2px] border border-xp-border px-3 py-1.5 text-xs text-xp-text transition-colors hover:border-xp-red/40 hover:bg-xp-red/15"
              >
                Replace All
              </button>
              <button
                onClick={() => onResolve('keep-both', true)}
                className="flex-1 rounded-[2px] border border-xp-border px-3 py-1.5 text-xs text-xp-text transition-colors hover:border-xp-blue/40 hover:bg-xp-blue/15"
              >
                Rename All
              </button>
              <button
                onClick={() => onResolve('skip', true)}
                className="flex-1 rounded-[2px] border border-xp-border px-3 py-1.5 text-xs text-xp-text transition-colors hover:bg-xp-surface"
              >
                Skip All
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const getKeepBothName = (name: string): string => {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  return `${base} (1)${ext}`;
};
