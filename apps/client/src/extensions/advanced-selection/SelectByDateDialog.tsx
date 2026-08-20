import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileEntry } from '@/lib/tauri-api';
import { DATE_RANGE_PRESETS } from './types';
import { getFileDateRange } from './selection-utils';

interface SelectByDateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (dateFrom: Date, dateTo: Date) => void;
  files: FileEntry[];
}

export const SelectByDateDialog = ({
  isOpen,
  onClose,
  onSelect,
  files,
}: SelectByDateDialogProps) => {
  const { t } = useTranslation();
  const dateRange = useMemo(() => getFileDateRange(files), [files]);

  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  const formatDateForInput = (date: Date): string => {
    return date.toISOString().split('T')[0];
  };

  const applyPreset = (preset: (typeof DATE_RANGE_PRESETS)[0]) => {
    const range = preset.getRange();
    setDateFrom(formatDateForInput(range.from));
    setDateTo(formatDateForInput(range.to));
    setSelectedPreset(preset.label);
  };

  const handleSelect = () => {
    if (dateFrom && dateTo) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      onSelect(from, to);
    }
    onClose();
  };

  const clearDates = () => {
    setDateFrom('');
    setDateTo('');
    setSelectedPreset(null);
  };

  // Count files in selected range
  const matchCount = useMemo(() => {
    if (!dateFrom || !dateTo) return 0;
    const from = new Date(dateFrom);
    from.setHours(0, 0, 0, 0);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    return files.filter((file) => {
      const fileDate = new Date(file.modified * 1000);
      return fileDate >= from && fileDate <= to;
    }).length;
  }, [files, dateFrom, dateTo]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[80vh] w-[450px] flex-col rounded-lg border border-xp-border bg-xp-surface shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-xp-border p-4">
          <h2 className="text-lg font-semibold text-xp-text">
            {t('advancedSelection.dialog.titleByDate')}
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
          {/* File Date Info */}
          <div className="rounded-md bg-xp-bg p-3 text-sm">
            <div className="flex justify-between text-xp-text-muted">
              <span>{t('advancedSelection.dialog.oldestFile')}</span>
              <span>{dateRange.oldest.toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between text-xp-text-muted">
              <span>{t('advancedSelection.dialog.newestFile')}</span>
              <span>{dateRange.newest.toLocaleDateString()}</span>
            </div>
          </div>

          {/* Presets */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-xp-text-muted">
              {t('advancedSelection.dialog.quickSelect')}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {DATE_RANGE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => applyPreset(preset)}
                  className={`rounded-md px-3 py-2 text-sm transition-colors ${
                    selectedPreset === preset.label
                      ? 'bg-xp-primary text-white'
                      : 'border border-xp-border bg-xp-bg hover:bg-xp-surface-light'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Date Range */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-xp-text-muted">
              {t('advancedSelection.dialog.customRange')}
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs text-xp-text-muted">
                  {t('advancedSelection.dialog.from')}
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setSelectedPreset(null);
                  }}
                  max={dateTo || undefined}
                  className="w-full rounded-md border border-xp-border bg-xp-bg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-xp-text-muted">
                  {t('advancedSelection.dialog.to')}
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setSelectedPreset(null);
                  }}
                  min={dateFrom || undefined}
                  className="w-full rounded-md border border-xp-border bg-xp-bg px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Preview Count */}
          {dateFrom && dateTo && (
            <div className="bg-xp-primary/10 border-xp-primary/30 flex items-center justify-between rounded-md border p-3">
              <span className="text-sm text-xp-text">
                {t('advancedSelection.dialog.filesMatching')}
              </span>
              <span className="text-xp-primary text-lg font-semibold">{matchCount}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-xp-border p-4">
          <button onClick={clearDates} className="text-sm text-xp-text-muted hover:text-xp-text">
            {t('advancedSelection.dialog.clear')}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-xp-text-muted hover:text-xp-text"
            >
              {t('advancedSelection.dialog.cancel')}
            </button>
            <button
              onClick={handleSelect}
              disabled={!dateFrom || !dateTo || matchCount === 0}
              className="bg-xp-primary rounded-md px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {t('advancedSelection.dialog.selectNFiles', { count: matchCount })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
