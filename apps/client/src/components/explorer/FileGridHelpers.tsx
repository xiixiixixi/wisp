import React from 'react';
import { FileEntry, FileTag } from '@/lib/tauri-api';
import { displayTagName } from '@/lib/finder-tags';
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

export const TagDots = ({ tags }: { tags: FileTag[] }) => {
  if (!tags || tags.length === 0) return null;

  // Finder style: small dots sitting inline right after the file name.
  return (
    <span className="ml-1 inline-flex flex-shrink-0 items-center gap-0.5 align-middle">
      {tags.map((tag) => (
        <span
          key={tag.name}
          className="h-[7px] w-[7px] flex-shrink-0 rounded-full border border-black/20"
          style={{ backgroundColor: tag.color }}
          title={displayTagName(tag.name)}
        />
      ))}
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
