import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TauriAPI, type FileTag } from '@/lib/tauri-api';
import { Tag, X, Plus, Check } from 'lucide-react';

const PRESET_COLORS: { label: string; value: string }[] = [
  { label: 'dialogs.colors.blue', value: '#7aa2f7' },
  { label: 'dialogs.colors.green', value: '#9ece6a' },
  { label: 'dialogs.colors.red', value: '#f7768e' },
  { label: 'dialogs.colors.orange', value: '#ff9e64' },
  { label: 'dialogs.colors.purple', value: '#bb9af7' },
  { label: 'dialogs.colors.yellow', value: '#e0af68' },
];

interface FileTagsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  /** Optional callback fired after tags have been saved successfully. */
  onSaved?: (tags: FileTag[]) => void;
}

const FileTagsDialog = ({ isOpen, onClose, filePath, onSaved }: FileTagsDialogProps) => {
  const { t } = useTranslation();
  const [tags, setTags] = useState<FileTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0].value);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load existing tags when dialog opens
  useEffect(() => {
    if (!isOpen || !filePath) return;
    setError(null);
    setNewTagName('');
    setSelectedColor(PRESET_COLORS[0].value);

    setLoading(true);
    TauriAPI.getFileTags(filePath)
      .then(setTags)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [isOpen, filePath]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleAddTag = () => {
    const name = newTagName.trim();
    if (!name) return;

    // Prevent duplicate names
    if (tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) {
      setError(t('dialogs.tags.duplicateError', { name }));
      return;
    }

    setTags((prev) => [...prev, { name, color: selectedColor }]);
    setNewTagName('');
    setError(null);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleRemoveTag = (index: number) => {
    setTags((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await TauriAPI.setFileTags(filePath, tags);
      onSaved?.(tags);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Dialog */}
      <div className="mx-4 flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-xp-border bg-xp-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-xp-border px-4 py-3">
          <div className="flex items-center space-x-2">
            <Tag className="h-4 w-4 text-xp-text-muted" />
            <div>
              <h2 className="text-sm font-semibold text-xp-text">{t('dialogs.tags.title')}</h2>
              <p className="max-w-xs truncate text-xs text-xp-text-muted" title={filePath}>
                {fileName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
            aria-label={t('dialogs.tags.closeAria')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-4 py-3">
          {/* Current tags */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-xp-text-muted">
              {t('dialogs.tags.currentTags')}
            </p>
            {(() => {
              if (loading) {
                return <p className="text-sm text-xp-text-muted">{t('common.loading')}</p>;
              }
              if (tags.length === 0) {
                return (
                  <p className="text-sm italic text-xp-text-muted">{t('dialogs.tags.empty')}</p>
                );
              }
              return (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag, idx) => (
                    <span
                      // eslint-disable-next-line react/no-array-index-key
                      key={idx}
                      className="inline-flex items-center space-x-1 rounded-full py-0.5 pl-2 pr-1 text-xs font-medium text-white"
                      style={{ backgroundColor: tag.color }}
                    >
                      <span>{tag.name}</span>
                      <button
                        onClick={() => handleRemoveTag(idx)}
                        className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-black hover:bg-opacity-20"
                        title={t('dialogs.tags.removeTag', { name: tag.name })}
                        aria-label={t('dialogs.tags.removeTagAria', { name: tag.name })}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Divider */}
          <div className="border-t border-xp-border" />

          {/* Add new tag */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-xp-text-muted">
              {t('dialogs.tags.addTag')}
            </p>

            {/* Color picker */}
            <div className="mb-2 flex items-center space-x-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setSelectedColor(c.value)}
                  className="flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all"
                  style={{
                    backgroundColor: c.value,
                    borderColor: selectedColor === c.value ? 'white' : 'transparent',
                    boxShadow: selectedColor === c.value ? `0 0 0 1px ${c.value}` : 'none',
                  }}
                  title={t(c.label)}
                  aria-label={t('dialogs.tags.selectColor', { color: t(c.label) })}
                >
                  {selectedColor === c.value && (
                    <Check className="h-2.5 w-2.5 text-white drop-shadow" />
                  )}
                </button>
              ))}
            </div>

            {/* Tag name input */}
            <div className="flex items-center space-x-2">
              <div className="relative flex-1">
                <span
                  className="absolute left-2 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full"
                  style={{ backgroundColor: selectedColor }}
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={newTagName}
                  onChange={(e) => {
                    setNewTagName(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={t('dialogs.tags.tagNamePlaceholder')}
                  maxLength={32}
                  className="w-full rounded border border-xp-border bg-xp-bg py-1.5 pl-7 pr-3 text-sm text-xp-text placeholder-xp-text-muted transition-colors focus:border-xp-blue focus:outline-none focus:ring-2 focus:ring-xp-blue"
                />
              </div>
              <button
                onClick={handleAddTag}
                disabled={!newTagName.trim()}
                className="flex items-center space-x-1 rounded bg-xp-blue px-2.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={t('dialogs.tags.addTagAria')}
              >
                <Plus className="h-3.5 w-3.5" />
                {/* add tag button */}
                <span>{t('common.add')}</span>
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="rounded border border-red-400 border-opacity-30 bg-red-400 bg-opacity-10 px-2 py-1 text-xs text-red-400">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-2 border-t border-xp-border px-4 py-3">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
            aria-label={t('dialogs.tags.cancelAria')}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center space-x-1.5 rounded bg-xp-blue px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('dialogs.tags.saveAria')}
          >
            {saving ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>{t('dialogs.tags.saving')}</span>
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                <span>{t('dialogs.tags.saveTags')}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FileTagsDialog;
