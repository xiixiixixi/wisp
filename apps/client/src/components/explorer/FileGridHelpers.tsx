import React from 'react';
import { FileEntry, FileTag } from '@/lib/tauri-api';
import { displayTagName, hexA } from '@/lib/finder-tags';
import i18n from '@/i18n';
import { Lock } from 'lucide-react';

export const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'ico',
  'svg',
  'avif',
  'tiff',
  'tif',
]);

export const isImageFile = (file: FileEntry): boolean => {
  if (file.is_dir) return false;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(ext);
};

// Dot-prefixed entries render dimmed (Finder-style ghost) in every view.
export const isHiddenFile = (file: FileEntry): boolean => file.name.startsWith('.');

// ─── Tag dots displayed under / beside a file name ───────────────────────────

/**
 * Tag chips — the file list stays monochrome ink; tags are its only
 * chroma. Each tag renders as a small glass chip: the tag colour tinted
 * at low alpha, a hairline border of the same hue, a softly glowing dot
 * (Finder's dot, now a lamp inside the chip) and the localised name in
 * the tag colour. At most two chips per row; the rest fold into +N.
 */
export const TagDots = ({ tags }: { tags: FileTag[] }) => {
  if (!tags || tags.length === 0) return null;

  const shown = tags.slice(0, 2);
  const rest = tags.length - shown.length;

  return (
    <span className="ml-1.5 inline-flex flex-shrink-0 items-center gap-1 align-middle">
      {shown.map((tag) => (
        <span
          key={tag.name}
          title={displayTagName(tag.name)}
          className="inline-flex h-4 max-w-24 flex-shrink-0 items-center gap-1 rounded-full border px-1.5"
          style={{
            backgroundColor: hexA(tag.color, 0.13),
            borderColor: hexA(tag.color, 0.3),
          }}
        >
          <span
            className="h-1 w-1 flex-shrink-0 rounded-full"
            style={{
              backgroundColor: tag.color,
              boxShadow: `0 0 5px ${hexA(tag.color, 0.75)}`,
            }}
          />
          <span
            className="truncate text-[9.5px] font-medium leading-none tracking-wide"
            style={{ color: tag.color }}
          >
            {displayTagName(tag.name)}
          </span>
        </span>
      ))}
      {rest > 0 && (
        <span className="bg-xp-surface/60 inline-flex h-4 flex-shrink-0 items-center rounded-full border border-xp-border px-1.5 text-[9.5px] font-medium leading-none text-xp-text-muted">
          +{rest}
        </span>
      )}
    </span>
  );
};

// ─── Git status dot displayed next to a file name ────────────────────────────

export const GitStatusDot = ({ status }: { status: string | null }) => {
  if (!status) return null;

  const colorMap: Record<string, string> = {
    new: '#22c55e', // green
    untracked: '#22c55e', // green
    modified: '#f97316', // orange
    renamed: '#f97316', // orange
    deleted: '#ef4444', // red
    conflict: '#ef4444', // red
    ignored: '#9ca3af', // gray
  };

  const color = colorMap[status] || '#9ca3af';
  const label = status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <span
      className="ml-1 inline-block h-2 w-2 flex-shrink-0 rounded-full"
      style={{ backgroundColor: color }}
      title={`Git: ${label}`}
    />
  );
};

// ─── Lock badge displayed on read-only files ──────────────────────────────────

export const LockBadge = ({ isReadonly }: { isReadonly: boolean }) => {
  if (!isReadonly) return null;

  return (
    <span
      className="ml-1 inline-flex flex-shrink-0 items-center"
      title={i18n.t('fileGrid.readOnly')}
      aria-label={i18n.t('fileGrid.readOnly')}
    >
      <Lock size={10} className="text-xp-text-muted opacity-70" />
    </span>
  );
};
