import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { FileEntry } from '@/lib/tauri-api';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  selectByExtension,
  selectByDateRange,
  selectBySizeRange,
  selectByPattern,
  invertSelection,
  getUniqueExtensions,
  countByExtension,
} from '@/extensions/advanced-selection/selection-utils';
import { COMMON_FILE_TYPES, DATE_RANGE_PRESETS } from '@/extensions/advanced-selection/types';

// ----- Types -----

type SelectionMode = 'select' | 'deselect' | 'invert';
type PatternMode = 'glob' | 'regex';
type SizeUnit = 'KB' | 'MB' | 'GB';
type HiddenFileMode = 'include' | 'only' | 'exclude';

const SIZE_UNIT_BYTES: Record<SizeUnit, number> = {
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

// ----- Props -----

interface AdvancedSelectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  files: FileEntry[];
  selectedFiles: Set<string>;
  setSelectedFiles: (files: Set<string>) => void;
  showToast: (options: {
    title: string;
    description: string;
    variant?: 'default' | 'destructive';
  }) => void;
}

// ----- Component -----

const AdvancedSelectDialog = ({
  isOpen,
  onClose,
  files,
  selectedFiles,
  setSelectedFiles,
  showToast,
}: AdvancedSelectDialogProps) => {
  const { t } = useTranslation();

  // Selection mode
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('select');

  // Filter enable toggles
  const [extensionEnabled, setExtensionEnabled] = useState(false);
  const [sizeEnabled, setSizeEnabled] = useState(false);
  const [dateEnabled, setDateEnabled] = useState(false);
  const [patternEnabled, setPatternEnabled] = useState(false);
  const [hiddenEnabled, setHiddenEnabled] = useState(false);

  // Extension filter state
  const [extensionInput, setExtensionInput] = useState('');
  const [selectedExtensions, setSelectedExtensions] = useState<Set<string>>(new Set());

  // Size filter state
  const [minSizeValue, setMinSizeValue] = useState('');
  const [minSizeUnit, setMinSizeUnit] = useState<SizeUnit>('KB');
  const [maxSizeValue, setMaxSizeValue] = useState('');
  const [maxSizeUnit, setMaxSizeUnit] = useState<SizeUnit>('MB');

  // Date filter state
  const [dateAfter, setDateAfter] = useState('');
  const [dateBefore, setDateBefore] = useState('');

  // Pattern filter state
  const [namePattern, setNamePattern] = useState('');
  const [patternMode, setPatternMode] = useState<PatternMode>('glob');

  // Hidden files filter state
  const [hiddenFileMode, setHiddenFileMode] = useState<HiddenFileMode>('include');

  // Directory info
  const _availableExtensions = useMemo(() => getUniqueExtensions(files), [files]);
  const extensionCounts = useMemo(() => countByExtension(files), [files]);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectionMode('select');
      setExtensionEnabled(false);
      setSizeEnabled(false);
      setDateEnabled(false);
      setPatternEnabled(false);
      setHiddenEnabled(false);
      setExtensionInput('');
      setSelectedExtensions(new Set());
      setMinSizeValue('');
      setMinSizeUnit('KB');
      setMaxSizeValue('');
      setMaxSizeUnit('MB');
      setDateAfter('');
      setDateBefore('');
      setNamePattern('');
      setPatternMode('glob');
      setHiddenFileMode('include');
    }
  }, [isOpen]);

  // ----- Matching logic -----

  const getMatchingPaths = useCallback((): Set<string> => {
    if (selectionMode === 'invert') {
      return new Set(invertSelection(files, selectedFiles));
    }

    // Start with all file paths, then intersect with each enabled filter
    let candidates = new Set(files.map((f) => f.path));

    // Hidden files filter
    if (hiddenEnabled) {
      const hiddenPaths = new Set<string>();
      files.forEach((f) => {
        const isHidden = f.name.startsWith('.');
        if (hiddenFileMode === 'only' && isHidden) {
          hiddenPaths.add(f.path);
        } else if (hiddenFileMode === 'include') {
          hiddenPaths.add(f.path); // includes everything
        } else if (hiddenFileMode === 'exclude' && !isHidden) {
          hiddenPaths.add(f.path);
        }
      });
      candidates = intersect(candidates, hiddenPaths);
    }

    // Extension filter
    if (extensionEnabled && selectedExtensions.size > 0) {
      const extPaths = new Set(selectByExtension(files, Array.from(selectedExtensions)));
      candidates = intersect(candidates, extPaths);
    }

    // Size filter
    if (sizeEnabled) {
      const minBytes = minSizeValue
        ? parseFloat(minSizeValue) * SIZE_UNIT_BYTES[minSizeUnit]
        : undefined;
      const maxBytes = maxSizeValue
        ? parseFloat(maxSizeValue) * SIZE_UNIT_BYTES[maxSizeUnit]
        : undefined;
      if (minBytes !== undefined || maxBytes !== undefined) {
        const sizePaths = new Set(selectBySizeRange(files, minBytes, maxBytes));
        candidates = intersect(candidates, sizePaths);
      }
    }

    // Date filter
    if (dateEnabled && (dateAfter || dateBefore)) {
      const from = dateAfter
        ? (() => {
            const d = new Date(dateAfter);
            d.setHours(0, 0, 0, 0);
            return d;
          })()
        : undefined;
      const to = dateBefore
        ? (() => {
            const d = new Date(dateBefore);
            d.setHours(23, 59, 59, 999);
            return d;
          })()
        : undefined;
      const datePaths = new Set(selectByDateRange(files, from, to));
      candidates = intersect(candidates, datePaths);
    }

    // Pattern filter
    if (patternEnabled && namePattern.trim()) {
      let patternPaths: Set<string>;
      if (patternMode === 'regex') {
        try {
          const regex = new RegExp(namePattern, 'i');
          patternPaths = new Set(files.filter((f) => regex.test(f.name)).map((f) => f.path));
        } catch {
          patternPaths = new Set(); // invalid regex
        }
      } else {
        patternPaths = new Set(selectByPattern(files, namePattern));
      }
      candidates = intersect(candidates, patternPaths);
    }

    // If no filters are enabled, nothing matches (don't accidentally select all)
    const anyFilterEnabled =
      extensionEnabled || sizeEnabled || dateEnabled || patternEnabled || hiddenEnabled;
    if (!anyFilterEnabled) {
      return new Set();
    }

    return candidates;
  }, [
    files,
    selectedFiles,
    selectionMode,
    extensionEnabled,
    selectedExtensions,
    sizeEnabled,
    minSizeValue,
    minSizeUnit,
    maxSizeValue,
    maxSizeUnit,
    dateEnabled,
    dateAfter,
    dateBefore,
    patternEnabled,
    namePattern,
    patternMode,
    hiddenEnabled,
    hiddenFileMode,
  ]);

  const matchingPaths = useMemo(() => getMatchingPaths(), [getMatchingPaths]);
  const matchCount = matchingPaths.size;

  // ----- Quick type buttons -----

  const selectQuickType = (extensions: string[]) => {
    setExtensionEnabled(true);
    const newSet = new Set(selectedExtensions);
    extensions.forEach((ext) => newSet.add(ext));
    setSelectedExtensions(newSet);
  };

  const addExtensionsFromInput = () => {
    if (!extensionInput.trim()) return;
    const exts = extensionInput
      .split(',')
      .map((e) => e.trim().replace(/^\./, '').toLowerCase())
      .filter(Boolean);
    if (exts.length > 0) {
      setExtensionEnabled(true);
      const newSet = new Set(selectedExtensions);
      exts.forEach((ext) => newSet.add(ext));
      setSelectedExtensions(newSet);
      setExtensionInput('');
    }
  };

  const removeExtension = (ext: string) => {
    const newSet = new Set(selectedExtensions);
    newSet.delete(ext);
    setSelectedExtensions(newSet);
  };

  // Quick date presets
  const applyDatePreset = (preset: (typeof DATE_RANGE_PRESETS)[number]) => {
    const range = preset.getRange();
    setDateEnabled(true);
    setDateAfter(formatDateForInput(range.from));
    setDateBefore(formatDateForInput(range.to));
  };

  // ----- Apply -----

  const handleApply = () => {
    if (selectionMode === 'invert') {
      const inverted = new Set(invertSelection(files, selectedFiles));
      setSelectedFiles(inverted);
      showToast({
        title: t('explorer.advancedSelect.toastInvertedTitle'),
        description: t('explorer.advancedSelect.toastInvertedDesc', {
          selected: inverted.size,
          total: files.length,
        }),
      });
    } else if (selectionMode === 'select') {
      setSelectedFiles(matchingPaths);
      showToast({
        title: t('explorer.advancedSelect.toastUpdatedTitle'),
        description: t('explorer.advancedSelect.toastSelectedDesc', {
          selected: matchingPaths.size,
          total: files.length,
        }),
      });
    } else {
      // deselect mode: remove matching from current selection
      const remaining = new Set(selectedFiles);
      matchingPaths.forEach((p) => remaining.delete(p));
      setSelectedFiles(remaining);
      showToast({
        title: t('explorer.advancedSelect.toastUpdatedTitle'),
        description: t('explorer.advancedSelect.toastDeselectedDesc', {
          deselected: matchingPaths.size,
          remaining: remaining.size,
        }),
      });
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-[600px] flex-col rounded-lg border border-xp-border bg-xp-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-xp-border p-4">
          <div className="flex items-center gap-2">
            <svg
              className="h-5 w-5 text-xp-accent"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
              />
            </svg>
            <h2 className="text-lg font-semibold text-xp-text">
              {t('explorer.advancedSelect.title')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-xp-text-muted hover:bg-xp-surface-light hover:text-xp-text"
            aria-label={t('explorer.advancedSelect.closeAria')}
          >
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

        {/* Scrollable content */}
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {/* Selection Mode */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-xp-text-muted">
              {t('explorer.advancedSelect.selectionMode')}
            </h3>
            <div className="flex gap-2">
              {[
                {
                  value: 'select' as SelectionMode,
                  label: t('explorer.advancedSelect.selectMatching'),
                },
                {
                  value: 'deselect' as SelectionMode,
                  label: t('explorer.advancedSelect.deselectMatching'),
                },
                {
                  value: 'invert' as SelectionMode,
                  label: t('explorer.advancedSelect.invertSelection'),
                },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSelectionMode(opt.value)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                    selectionMode === opt.value
                      ? 'border-xp-accent bg-xp-accent text-white'
                      : 'border-xp-border bg-xp-bg text-xp-text hover:bg-xp-surface-light'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Only show filters when not in invert mode */}
          {selectionMode !== 'invert' && (
            <>
              {/* ---- By Extension ---- */}
              <FilterSection
                title={t('explorer.advancedSelect.byExtension')}
                enabled={extensionEnabled}
                onToggle={setExtensionEnabled}
              >
                {/* Extension text input */}
                <div className="mb-3 flex gap-2">
                  <input
                    type="text"
                    value={extensionInput}
                    onChange={(e) => setExtensionInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addExtensionsFromInput()}
                    placeholder="jpg, png, gif"
                    className="flex-1 rounded-md border border-xp-border bg-xp-bg px-3 py-2 text-sm text-xp-text placeholder-xp-text-muted focus:border-xp-blue focus:outline-none focus:ring-2 focus:ring-xp-blue"
                  />
                  <button
                    onClick={addExtensionsFromInput}
                    disabled={!extensionInput.trim()}
                    className="rounded-md bg-xp-accent px-3 py-2 text-sm text-white disabled:opacity-50"
                    aria-label={t('explorer.advancedSelect.addExtensionsAria')}
                  >
                    {t('common.add')}
                  </button>
                </div>

                {/* Quick type buttons */}
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {COMMON_FILE_TYPES.map((type) => (
                    <button
                      key={type.label}
                      onClick={() => selectQuickType(type.extensions)}
                      className="rounded border border-xp-border bg-xp-bg px-2 py-1 text-xs text-xp-text transition-colors hover:bg-blue-500/20"
                    >
                      {type.label}
                    </button>
                  ))}
                </div>

                {/* Selected extensions chips */}
                {selectedExtensions.size > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {Array.from(selectedExtensions).map((ext) => (
                      <span
                        key={ext}
                        className="inline-flex items-center gap-1 rounded bg-blue-500/20 px-2 py-0.5 text-xs text-xp-accent"
                      >
                        .{ext}
                        {extensionCounts.get(ext) !== undefined && (
                          <span className="text-xp-text-muted">({extensionCounts.get(ext)})</span>
                        )}
                        <button
                          onClick={() => removeExtension(ext)}
                          className="ml-0.5 hover:text-xp-text"
                        >
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
                    <button
                      onClick={() => setSelectedExtensions(new Set())}
                      className="px-1 text-xs text-xp-text-muted hover:text-xp-text"
                    >
                      {t('common.clear')}
                    </button>
                  </div>
                )}
              </FilterSection>

              {/* ---- By Size Range ---- */}
              <FilterSection
                title={t('explorer.advancedSelect.bySizeRange')}
                enabled={sizeEnabled}
                onToggle={setSizeEnabled}
              >
                <div className="flex items-center gap-2">
                  <span className="w-8 text-xs text-xp-text-muted">
                    {t('explorer.advancedSelect.min')}
                  </span>
                  <input
                    type="number"
                    value={minSizeValue}
                    onChange={(e) => setMinSizeValue(e.target.value)}
                    min="0"
                    placeholder="0"
                    className="flex-1 rounded-md border border-xp-border bg-xp-bg px-3 py-1.5 text-sm text-xp-text focus:border-xp-blue focus:outline-none focus:ring-2 focus:ring-xp-blue"
                  />
                  <Select value={minSizeUnit} onValueChange={(v) => setMinSizeUnit(v as SizeUnit)}>
                    <SelectTrigger className="h-8 w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="KB">KB</SelectItem>
                      <SelectItem value="MB">MB</SelectItem>
                      <SelectItem value="GB">GB</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="w-8 text-xs text-xp-text-muted">
                    {t('explorer.advancedSelect.max')}
                  </span>
                  <input
                    type="number"
                    value={maxSizeValue}
                    onChange={(e) => setMaxSizeValue(e.target.value)}
                    min="0"
                    placeholder={t('explorer.advancedSelect.noLimit')}
                    className="flex-1 rounded-md border border-xp-border bg-xp-bg px-3 py-1.5 text-sm text-xp-text focus:border-xp-blue focus:outline-none focus:ring-2 focus:ring-xp-blue"
                  />
                  <Select value={maxSizeUnit} onValueChange={(v) => setMaxSizeUnit(v as SizeUnit)}>
                    <SelectTrigger className="h-8 w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="KB">KB</SelectItem>
                      <SelectItem value="MB">MB</SelectItem>
                      <SelectItem value="GB">GB</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </FilterSection>

              {/* ---- By Date Range ---- */}
              <FilterSection
                title={t('explorer.advancedSelect.byDateRange')}
                enabled={dateEnabled}
                onToggle={setDateEnabled}
              >
                <div className="mb-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-xp-text-muted">
                      {t('explorer.advancedSelect.modifiedAfter')}
                    </label>
                    <input
                      type="date"
                      value={dateAfter}
                      onChange={(e) => setDateAfter(e.target.value)}
                      className="w-full rounded-md border border-xp-border bg-xp-bg px-3 py-1.5 text-sm text-xp-text focus:border-xp-blue focus:outline-none focus:ring-2 focus:ring-xp-blue"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-xp-text-muted">
                      {t('explorer.advancedSelect.modifiedBefore')}
                    </label>
                    <input
                      type="date"
                      value={dateBefore}
                      onChange={(e) => setDateBefore(e.target.value)}
                      className="w-full rounded-md border border-xp-border bg-xp-bg px-3 py-1.5 text-sm text-xp-text focus:border-xp-blue focus:outline-none focus:ring-2 focus:ring-xp-blue"
                    />
                  </div>
                </div>
                {/* Quick date buttons */}
                <div className="flex flex-wrap gap-1.5">
                  {DATE_RANGE_PRESETS.filter((p) =>
                    [
                      i18n.t('advancedSelection.presets.today'),
                      i18n.t('advancedSelection.presets.last7days'),
                      i18n.t('advancedSelection.presets.last30days'),
                      i18n.t('advancedSelection.presets.thisYear'),
                    ].includes(p.label),
                  ).map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => applyDatePreset(preset)}
                      className="rounded border border-xp-border bg-xp-bg px-2 py-1 text-xs text-xp-text transition-colors hover:bg-blue-500/20"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </FilterSection>

              {/* ---- By Name Pattern ---- */}
              <FilterSection
                title={t('explorer.advancedSelect.byNamePattern')}
                enabled={patternEnabled}
                onToggle={setPatternEnabled}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={namePattern}
                    onChange={(e) => setNamePattern(e.target.value)}
                    placeholder={patternMode === 'glob' ? '*.txt' : '.*\\.txt$'}
                    className="flex-1 rounded-md border border-xp-border bg-xp-bg px-3 py-1.5 font-mono text-sm text-xp-text placeholder-xp-text-muted focus:border-xp-blue focus:outline-none focus:ring-2 focus:ring-xp-blue"
                  />
                  <div className="flex overflow-hidden rounded-md border border-xp-border">
                    <button
                      onClick={() => setPatternMode('glob')}
                      className={`px-2 py-1.5 text-xs transition-colors ${
                        patternMode === 'glob'
                          ? 'bg-xp-accent text-white'
                          : 'bg-xp-bg text-xp-text hover:bg-xp-surface-light'
                      }`}
                    >
                      Glob
                    </button>
                    <button
                      onClick={() => setPatternMode('regex')}
                      className={`px-2 py-1.5 text-xs transition-colors ${
                        patternMode === 'regex'
                          ? 'bg-xp-accent text-white'
                          : 'bg-xp-bg text-xp-text hover:bg-xp-surface-light'
                      }`}
                    >
                      Regex
                    </button>
                  </div>
                </div>
              </FilterSection>

              {/* ---- Hidden Files ---- */}
              <FilterSection
                title={t('explorer.advancedSelect.hiddenFiles')}
                enabled={hiddenEnabled}
                onToggle={setHiddenEnabled}
              >
                <div className="flex gap-2">
                  {[
                    {
                      value: 'include' as HiddenFileMode,
                      label: t('explorer.advancedSelect.includeHidden'),
                    },
                    {
                      value: 'only' as HiddenFileMode,
                      label: t('explorer.advancedSelect.onlyHidden'),
                    },
                    {
                      value: 'exclude' as HiddenFileMode,
                      label: t('explorer.advancedSelect.excludeHidden'),
                    },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setHiddenFileMode(opt.value)}
                      className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                        hiddenFileMode === opt.value
                          ? 'border-xp-accent bg-xp-accent text-white'
                          : 'border-xp-border bg-xp-bg text-xp-text hover:bg-xp-surface-light'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </FilterSection>
            </>
          )}
        </div>

        {/* Footer with preview + actions */}
        <div className="border-t border-xp-border p-4">
          {/* Match preview */}
          <div className="mb-3 flex items-center justify-between rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2">
            <span className="text-sm text-xp-text">
              {selectionMode === 'invert'
                ? t('explorer.advancedSelect.filesAfterInvert')
                : t('explorer.advancedSelect.filesMatching')}
            </span>
            <span className="text-lg font-semibold text-xp-accent">
              {matchCount}{' '}
              <span className="text-sm font-normal text-xp-text-muted">
                {t('explorer.advancedSelect.ofTotal', { total: files.length })}
              </span>
            </span>
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-xp-border px-4 py-2 text-sm text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
              aria-label={t('explorer.advancedSelect.cancelAria')}
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleApply}
              disabled={matchCount === 0 && selectionMode !== 'deselect'}
              className="rounded-md bg-xp-accent px-4 py-2 text-sm text-white transition-colors hover:bg-xp-accent-hover disabled:opacity-50"
              aria-label={t('explorer.advancedSelect.applyAria')}
            >
              {t('explorer.advancedSelect.applySelection')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ----- Helper: Filter Section Component -----

interface FilterSectionProps {
  title: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children: React.ReactNode;
}

const FilterSection = ({ title, enabled, onToggle, children }: FilterSectionProps) => {
  return (
    <div
      className={`rounded-lg border transition-colors ${
        enabled ? 'border-blue-500/40 bg-blue-500/5' : 'bg-xp-bg/30 border-xp-border'
      }`}
    >
      <label className="flex cursor-pointer select-none items-center gap-2 p-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="rounded border-xp-border accent-xp-accent"
        />
        <span className={`text-sm font-medium ${enabled ? 'text-xp-text' : 'text-xp-text-muted'}`}>
          {title}
        </span>
      </label>
      {enabled && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
};

// ----- Utility -----

const intersect = (a: Set<string>, b: Set<string>): Set<string> => {
  const result = new Set<string>();
  for (const item of a) {
    if (b.has(item)) {
      result.add(item);
    }
  }
  return result;
};

const formatDateForInput = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

export default AdvancedSelectDialog;
