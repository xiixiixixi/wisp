import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileEntry } from '@/lib/tauri-api';
import { COMMON_FILE_TYPES } from './types';
import { getUniqueExtensions, countByExtension } from './selection-utils';

interface SelectByExtensionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (extensions: string[]) => void;
  files: FileEntry[];
}

export const SelectByExtensionDialog = ({
  isOpen,
  onClose,
  onSelect,
  files,
}: SelectByExtensionDialogProps) => {
  const { t } = useTranslation();
  const [selectedExtensions, setSelectedExtensions] = useState<Set<string>>(new Set());
  const [customExtension, setCustomExtension] = useState('');

  // Get extensions present in current directory
  const availableExtensions = useMemo(() => getUniqueExtensions(files), [files]);
  const extensionCounts = useMemo(() => countByExtension(files), [files]);

  // Filter common file types to only show those with files present
  const relevantFileTypes = useMemo(() => {
    return COMMON_FILE_TYPES.filter((type) =>
      type.extensions.some((ext) => availableExtensions.includes(ext)),
    );
  }, [availableExtensions]);

  const toggleExtension = (ext: string) => {
    const newSet = new Set(selectedExtensions);
    if (newSet.has(ext)) {
      newSet.delete(ext);
    } else {
      newSet.add(ext);
    }
    setSelectedExtensions(newSet);
  };

  const selectCategory = (extensions: string[]) => {
    const newSet = new Set(selectedExtensions);
    const relevant = extensions.filter((ext) => availableExtensions.includes(ext));
    relevant.forEach((ext) => newSet.add(ext));
    setSelectedExtensions(newSet);
  };

  const addCustomExtension = () => {
    if (customExtension.trim()) {
      const ext = customExtension.trim().replace(/^\./, '').toLowerCase();
      const newSet = new Set(selectedExtensions);
      newSet.add(ext);
      setSelectedExtensions(newSet);
      setCustomExtension('');
    }
  };

  const handleSelect = () => {
    if (selectedExtensions.size > 0) {
      onSelect(Array.from(selectedExtensions));
    }
    onClose();
  };

  const clearSelection = () => {
    setSelectedExtensions(new Set());
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[80vh] w-[500px] flex-col rounded-lg border border-xp-border bg-xp-surface shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-xp-border p-4">
          <h2 className="text-lg font-semibold text-xp-text">
            {t('advancedSelection.dialog.titleByFileType')}
          </h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-xp-surface-light">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* Quick Categories */}
          {relevantFileTypes.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-xp-text-muted">
                {t('advancedSelection.dialog.quickSelect')}
              </h3>
              <div className="flex flex-wrap gap-2">
                {relevantFileTypes.map((type) => (
                  <button
                    key={type.label}
                    onClick={() => selectCategory(type.extensions)}
                    className="hover:bg-xp-accent/20 rounded-md border border-xp-border bg-xp-bg px-3 py-1.5 text-sm transition-colors"
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Available Extensions */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-xp-text-muted">
              {t('advancedSelection.dialog.extensionsInFolder', {
                count: availableExtensions.length,
              })}
            </h3>
            <div className="grid max-h-48 grid-cols-3 gap-2 overflow-y-auto">
              {availableExtensions.map((ext) => (
                <label
                  key={ext}
                  className={`flex cursor-pointer items-center gap-2 rounded p-2 transition-colors ${
                    selectedExtensions.has(ext)
                      ? 'border border-xp-accent bg-blue-500/20'
                      : 'border border-transparent bg-xp-bg hover:bg-xp-surface-light'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedExtensions.has(ext)}
                    onChange={() => toggleExtension(ext)}
                    className="rounded border-xp-border"
                  />
                  <span className="text-sm">.{ext}</span>
                  <span className="ml-auto text-xs text-xp-text-muted">
                    ({extensionCounts.get(ext) || 0})
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Custom Extension */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-xp-text-muted">
              {t('advancedSelection.dialog.customExtension')}
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={customExtension}
                onChange={(e) => setCustomExtension(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCustomExtension()}
                placeholder={t('advancedSelection.dialog.customExtPlaceholder')}
                className="flex-1 rounded-md border border-xp-border bg-xp-bg px-3 py-2 text-sm"
              />
              <button
                onClick={addCustomExtension}
                disabled={!customExtension.trim()}
                className="rounded-md bg-xp-accent px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {t('advancedSelection.dialog.add')}
              </button>
            </div>
          </div>

          {/* Selected Extensions */}
          {selectedExtensions.size > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium text-xp-text-muted">
                  {t('advancedSelection.dialog.selected', { count: selectedExtensions.size })}
                </h3>
                <button
                  onClick={clearSelection}
                  className="text-xs text-xp-text-muted hover:text-xp-text"
                >
                  {t('advancedSelection.dialog.clearAll')}
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {Array.from(selectedExtensions).map((ext) => (
                  <span
                    key={ext}
                    className="inline-flex items-center gap-1 rounded bg-blue-500/20 px-2 py-1 text-sm text-xp-accent"
                  >
                    .{ext}
                    <button onClick={() => toggleExtension(ext)} className="hover:text-xp-text">
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-xp-border p-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-xp-text-muted hover:text-xp-text"
          >
            {t('advancedSelection.dialog.cancel')}
          </button>
          <button
            onClick={handleSelect}
            disabled={selectedExtensions.size === 0}
            className="rounded-md bg-xp-accent px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {t('advancedSelection.dialog.selectFiles')}
          </button>
        </div>
      </div>
    </div>
  );
};
