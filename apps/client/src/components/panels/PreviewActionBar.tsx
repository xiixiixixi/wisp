import React, { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, ExternalLink, Files, Link2, Pencil, Trash2, Type } from 'lucide-react';
import { FileEntry, TauriAPI } from '@/lib/tauri-api';
import { defaultPreviewFactory, PreviewType } from '@/lib/preview-factory';
import { showConfirmationToast, showInputToast } from '@/components/ui/Toast';

/** Preview types whose content is plain text and can be copied verbatim. */
const TEXT_LIKE_TYPES: PreviewType[] = ['text', 'code', 'csv', 'json', 'markdown', 'html'];

/** Refuse to copy content of text files larger than this (clipboard flood guard). */
const MAX_COPY_BYTES = 2 * 1024 * 1024;

interface PreviewActionBarProps {
  file: FileEntry;
}

/** Tiny feedback label that fades out after a short delay. */
const useFeedback = (): [string | null, (msg: string) => void] => {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMsg(text);
    timer.current = setTimeout(() => {
      setMsg(null);
      timer.current = null;
    }, 1500);
  }, []);
  return [msg, show];
};

const PATH_SEP_RE = /[/\\]/;

/**
 * Quick-actions bar for the file preview panel.
 * Renders a compact horizontal row of icon buttons for common file operations.
 */
const PreviewActionBar = ({ file }: PreviewActionBarProps) => {
  const { t } = useTranslation();
  const [feedback, showFeedback] = useFeedback();

  // ── Actions ────────────────────────────────────────────────────────────

  const handleOpen = useCallback(async () => {
    try {
      await TauriAPI.openFile(file.path);
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, [file.path]);

  const handleCopyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(file.path);
      showFeedback(t('panels.previewAction.pathCopied'));
    } catch (err) {
      console.error('Failed to copy path:', err);
    }
  }, [file.path, showFeedback, t]);

  const handleCopyName = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(file.name);
      showFeedback(t('panels.previewAction.nameCopied'));
    } catch (err) {
      console.error('Failed to copy name:', err);
    }
  }, [file.name, showFeedback, t]);

  const handleCopyContent = useCallback(async () => {
    if (file.size > MAX_COPY_BYTES) {
      showFeedback(t('panels.previewAction.contentTooLarge'));
      return;
    }
    try {
      const content = await TauriAPI.readTextFile(file.path);
      await navigator.clipboard.writeText(content);
      showFeedback(t('panels.previewAction.contentCopied'));
    } catch (err) {
      console.error('Failed to copy content:', err);
    }
  }, [file.path, file.size, showFeedback, t]);

  const handleDuplicate = useCallback(async () => {
    try {
      const parts = file.path.split(PATH_SEP_RE);
      const sep = file.path.includes('\\') ? '\\' : '/';
      const parentDir = parts.slice(0, -1).join(sep);
      const dotIdx = file.name.lastIndexOf('.');
      let destName: string;
      if (file.is_dir) {
        destName = `${file.name} - Copy`;
      } else if (dotIdx > 0) {
        destName = `${file.name.slice(0, dotIdx)} - Copy${file.name.slice(dotIdx)}`;
      } else {
        destName = `${file.name} - Copy`;
      }
      const destPath = `${parentDir}${sep}${destName}`;
      await TauriAPI.copy(file.path, destPath);
      window.dispatchEvent(new CustomEvent('files-changed'));
      showFeedback(t('panels.previewAction.duplicated'));
    } catch (err) {
      console.error('Failed to duplicate file:', err);
    }
  }, [file.path, file.name, file.is_dir, showFeedback, t]);

  const handleRename = useCallback(async () => {
    const newName = await showInputToast({
      title: t('panels.previewAction.renameTitle'),
      description: t('panels.previewAction.renameDescription'),
      placeholder: file.name,
      submitText: t('common.rename'),
      cancelText: t('common.cancel'),
    });
    if (newName && newName !== file.name) {
      try {
        const parts = file.path.split(PATH_SEP_RE);
        parts[parts.length - 1] = newName;
        const sep = file.path.includes('\\') ? '\\' : '/';
        const newPath = parts.join(sep);
        await TauriAPI.rename(file.path, newPath);
        window.dispatchEvent(new CustomEvent('files-changed'));
        showFeedback(t('panels.previewAction.renamed'));
      } catch (err) {
        console.error('Failed to rename file:', err);
      }
    }
  }, [file.path, file.name, showFeedback, t]);

  const handleDelete = useCallback(async () => {
    const confirmed = await showConfirmationToast({
      title: t('panels.previewAction.deleteTitle'),
      description: t('panels.previewAction.deleteDescription', { name: file.name }),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
    });
    if (confirmed) {
      try {
        await TauriAPI.moveToTrash(file.path);
        window.dispatchEvent(new CustomEvent('files-changed'));
        showFeedback(t('panels.previewAction.deleted'));
      } catch (err) {
        console.error('Failed to delete file:', err);
      }
    }
  }, [file.path, file.name, showFeedback, t]);

  // ── Button definitions ─────────────────────────────────────────────────

  const actions: {
    key: string;
    icon: React.ReactNode;
    label: string;
    tooltip: string;
    onClick: () => void;
    danger?: boolean;
  }[] = [
    {
      key: 'open',
      icon: <ExternalLink size={14} strokeWidth={1.75} />,
      label: t('common.open'),
      tooltip: t('panels.previewAction.openTooltip'),
      onClick: handleOpen,
    },
    {
      key: 'copy-path',
      icon: <Link2 size={14} strokeWidth={1.75} />,
      label: t('panels.previewAction.copyPath'),
      tooltip: t('panels.previewAction.copyPathTooltip'),
      onClick: handleCopyPath,
    },
    {
      key: 'copy-name',
      icon: <Type size={14} strokeWidth={1.75} />,
      label: t('panels.previewAction.copyName'),
      tooltip: t('panels.previewAction.copyNameTooltip'),
      onClick: handleCopyName,
    },
    ...(TEXT_LIKE_TYPES.includes(defaultPreviewFactory.getFileType(file))
      ? [
          {
            key: 'copy-content',
            icon: <Copy size={14} strokeWidth={1.75} />,
            label: t('panels.previewAction.copyContent'),
            tooltip: t('panels.previewAction.copyContentTooltip'),
            onClick: handleCopyContent,
          },
        ]
      : []),
    {
      key: 'duplicate',
      icon: <Files size={14} strokeWidth={1.75} />,
      label: t('common.duplicate'),
      tooltip: t('panels.previewAction.duplicateTooltip'),
      onClick: handleDuplicate,
    },
    {
      key: 'rename',
      icon: <Pencil size={14} strokeWidth={1.75} />,
      label: t('common.rename'),
      tooltip: t('panels.previewAction.renameTooltip'),
      onClick: handleRename,
    },
    {
      key: 'delete',
      icon: <Trash2 size={14} strokeWidth={1.75} />,
      label: t('common.delete'),
      tooltip: t('panels.previewAction.deleteTooltip'),
      onClick: handleDelete,
      danger: true,
    },
  ];

  // ── Styles ──────────────────────────────────────────────────────────────

  const barStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '2px',
    padding: '6px 8px',
    borderBottom: '1px solid color-mix(in srgb, var(--xp-border) 55%, transparent)',
    background: 'var(--xp-surface)',
    alignItems: 'center',
    position: 'relative',
  };

  const btnBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '5px',
    padding: '4px 10px',
    borderRadius: 4,
    border: '1px solid transparent',
    background: 'transparent',
    color: 'var(--xp-text-secondary)',
    fontSize: '11px',
    lineHeight: 1.2,
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };

  const feedbackStyle: React.CSSProperties = {
    position: 'absolute',
    right: 10,
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: '10px',
    color: 'var(--xp-green)',
    pointerEvents: 'none',
    animation: 'fadeIn 0.15s ease-out',
  };

  return (
    <div style={barStyle} role="toolbar" aria-label={t('panels.previewAction.quickActions')}>
      {actions.map(({ key, icon, label, tooltip, onClick, danger }) => (
        <button
          key={key}
          onClick={onClick}
          title={tooltip}
          aria-label={tooltip}
          style={btnBase}
          onMouseEnter={(e) => {
            const target = e.currentTarget;
            target.style.background = danger
              ? 'color-mix(in srgb, var(--xp-red) 12%, transparent)'
              : 'var(--xp-surface-light)';
            target.style.color = danger ? 'var(--xp-red)' : 'var(--xp-text)';
            target.style.borderColor = danger
              ? 'color-mix(in srgb, var(--xp-red) 30%, transparent)'
              : 'color-mix(in srgb, var(--xp-border) 70%, transparent)';
          }}
          onMouseLeave={(e) => {
            const target = e.currentTarget;
            target.style.background = 'transparent';
            target.style.color = 'var(--xp-text-secondary)';
            target.style.borderColor = 'transparent';
          }}
        >
          {icon}
          <span>{label}</span>
        </button>
      ))}
      {feedback && <span style={feedbackStyle}>{feedback}</span>}
    </div>
  );
};

export default PreviewActionBar;
