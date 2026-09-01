import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TauriAPI, type FileTag } from '@/lib/tauri-api';
import { FINDER_TAG_COLORS, displayTagName } from '@/lib/finder-tags';
import { setCachedFileTags, notifyFileTagsChanged } from '@/lib/file-tags-cache';
import { Tag, X, Plus, Check } from 'lucide-react';

interface FileTagsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  /** Optional callback fired after tags have been saved successfully. */
  onSaved?: (tags: FileTag[]) => void;
}

const CUSTOM_TAGS_KEY = 'wisp:custom-finder-tags';

const loadCustomTags = (): FileTag[] => {
  try {
    const raw = localStorage.getItem(CUSTOM_TAGS_KEY);
    return raw ? (JSON.parse(raw) as FileTag[]) : [];
  } catch {
    return [];
  }
};

const persistCustomTags = (tags: FileTag[]): void => {
  localStorage.setItem(CUSTOM_TAGS_KEY, JSON.stringify(tags));
};

/**
 * Finder-style tag editor: toggle the palette (Finder's own list, plus any
 * custom tags created here) directly on the file. Tags are written to the
 * file's Finder-tag metadata, so Finder and Spotlight see the same tags.
 */
const FileTagsDialog = ({ isOpen, onClose, filePath, onSaved }: FileTagsDialogProps) => {
  const { t } = useTranslation();
  const [tags, setTags] = useState<FileTag[]>([]);
  const [palette, setPalette] = useState<FileTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [selectedColor, setSelectedColor] = useState(FINDER_TAG_COLORS[0].hex);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || !filePath) return;
    setError(null);
    setNewTagName('');
    setSelectedColor(FINDER_TAG_COLORS[0].hex);
    setLoading(true);

    Promise.all([TauriAPI.getFileTags(filePath), TauriAPI.getAllFileTags()])
      .then(([fileTags, allTags]) => {
        setTags(fileTags);
        // Merge Finder's palette with any custom tags created in Wisp.
        const custom = loadCustomTags();
        const names = new Set(allTags.map((tag) => tag.name));
        setPalette([...allTags, ...custom.filter((tag) => !names.has(tag.name))]);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [isOpen, filePath]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const writeTags = async (next: FileTag[]) => {
    setSaving(true);
    setError(null);
    try {
      await TauriAPI.setFileTags(filePath, next);
      setTags(next);
      setCachedFileTags(filePath, next);
      notifyFileTagsChanged();
      onSaved?.(next);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleTag = (tag: FileTag) => {
    if (saving) return;
    const next = tags.some((x) => x.name === tag.name)
      ? tags.filter((x) => x.name !== tag.name)
      : [...tags, tag];
    writeTags(next);
  };

  const handleCreate = async () => {
    const name = newTagName.trim();
    if (!name || saving) return;
    if ([...palette, ...tags].some((tag) => tag.name.toLowerCase() === name.toLowerCase())) {
      setError(t('dialogs.tags.duplicateError', { name }));
      return;
    }
    const tag: FileTag = { name, color: selectedColor };
    const nextCustom = [...loadCustomTags(), tag];
    persistCustomTags(nextCustom);
    setPalette((prev) => [...prev, tag]);
    setNewTagName('');
    setError(null);
    await writeTags([...tags, tag]);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreate();
    } else if (e.key === 'Escape') {
      onClose();
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
          {/* Palette — click to toggle, Finder-style */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-xp-text-muted">
              {t('dialogs.tags.palette')}
            </p>
            {loading ? (
              <p className="text-sm text-xp-text-muted">{t('common.loading')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {palette.map((tag) => {
                  const active = tags.some((x) => x.name === tag.name);
                  return (
                    <button
                      key={tag.name}
                      onClick={() => toggleTag(tag)}
                      className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors ${
                        active
                          ? 'border-xp-accent bg-xp-accent/10 text-xp-text'
                          : 'border-xp-border text-xp-text-secondary hover:bg-xp-surface-light hover:text-xp-text'
                      }`}
                      aria-pressed={active}
                    >
                      <span
                        className="h-3 w-3 flex-shrink-0 rounded border border-xp-border"
                        style={{ backgroundColor: tag.color }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">{displayTagName(tag.name)}</span>
                      {active && <Check className="h-3.5 w-3.5 flex-shrink-0 text-xp-accent" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* New custom tag */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-xp-text-muted">
              {t('dialogs.tags.newTag')}
            </p>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('dialogs.tags.tagNamePlaceholder')}
                className="h-8 min-w-0 flex-1 rounded-md border border-xp-border bg-xp-bg px-2.5 text-sm text-xp-text placeholder:text-xp-text-muted focus:border-xp-accent focus:outline-none"
                aria-label={t('dialogs.tags.addTag')}
              />
              <div className="flex items-center gap-1">
                {FINDER_TAG_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    onClick={() => setSelectedColor(c.hex)}
                    className={`h-5 w-5 rounded border transition-transform ${
                      selectedColor === c.hex
                        ? 'scale-110 border-white ring-1 ring-xp-accent'
                        : 'border-xp-border hover:scale-105'
                    }`}
                    style={{ backgroundColor: c.hex }}
                    aria-label={t('dialogs.tags.selectColor', {
                      color: t(`dialogs.colors.${c.id}`),
                    })}
                  />
                ))}
              </div>
              <button
                onClick={handleCreate}
                disabled={!newTagName.trim() || saving}
                className="flex h-8 items-center gap-1 rounded-md bg-xp-accent px-2.5 text-xs font-medium text-white transition-colors hover:bg-xp-accent-hover disabled:opacity-50"
                aria-label={t('dialogs.tags.addTag')}
              >
                <Plus className="h-3.5 w-3.5" />
                {t('dialogs.tags.addTag')}
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-xp-red">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-xp-border px-4 py-3">
          <p className="text-xs text-xp-text-muted">{t('dialogs.tags.finderSyncNote')}</p>
          <button
            onClick={onClose}
            className="rounded-md border border-xp-border px-3 py-1.5 text-sm text-xp-text transition-colors hover:bg-xp-surface-light"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FileTagsDialog;
