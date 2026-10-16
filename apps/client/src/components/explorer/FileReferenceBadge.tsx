import React from 'react';
import { CornerUpRight, Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FileEntry } from '@/lib/tauri-api';

interface FileReferenceBadgeProps {
  file: FileEntry;
  children: React.ReactNode;
  compact?: boolean;
  className?: string;
}

/** File icon wrapper that marks symbolic links and macOS Finder aliases. */
export const FileReferenceBadge = ({
  file,
  children,
  compact = false,
  className = '',
}: FileReferenceBadgeProps) => {
  const { t } = useTranslation();
  if (!file.is_symlink && !file.is_alias) return <>{children}</>;

  const isSymlink = !!file.is_symlink;
  let label = t('fileReference.alias');
  if (isSymlink) {
    label = file.symlink_target
      ? t('fileReference.symlinkTo', { target: file.symlink_target })
      : t('fileReference.symlink');
  }
  // The marker must remain recognisable in dense detail/tree rows. At 10 px
  // it rendered as a coloured dot on a real page, so keep the compact variant
  // only slightly smaller than the regular grid marker.
  const badgeSize = compact ? 13 : 16;
  const Icon = isSymlink ? Link2 : CornerUpRight;

  return (
    <span className={`relative inline-flex items-center justify-center ${className}`} title={label}>
      {children}
      <span
        role="img"
        aria-label={label}
        style={{
          position: 'absolute',
          right: compact ? -5 : -6,
          bottom: compact ? -4 : -5,
          width: badgeSize,
          height: badgeSize,
          borderRadius: '3px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--xp-bg)',
          backgroundColor: isSymlink ? 'var(--xp-blue)' : 'var(--xp-purple)',
          border: '1.5px solid var(--xp-surface)',
          zIndex: 2,
        }}
      >
        <Icon size={compact ? 8 : 10} strokeWidth={3} aria-hidden="true" />
      </span>
    </span>
  );
};

export const getFileReferenceLabel = (
  file: FileEntry,
  t: ReturnType<typeof useTranslation>['t'],
): string | null => {
  if (file.is_symlink) return t('fileReference.symlink');
  if (file.is_alias) return t('fileReference.alias');
  return null;
};
