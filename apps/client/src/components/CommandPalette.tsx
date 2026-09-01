import React, { useState, useEffect, useRef, useCallback, useMemo, useDeferredValue } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { TauriAPI, SearchResult, RecentFile } from '@/lib/tauri-api';
import { File, Files, Folder, Search, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  formatTimestamp,
  sectionHeaderStyle,
  itemBaseStyle,
  itemSelectedStyle,
  iconWrapStyle,
  shortcutStyle,
  timestampStyle,
  kbdStyle,
  fileNameContainerStyle,
  fileNameStyle,
  filePathStyle,
  backdropStyle,
  dialogStyle,
  searchBarStyle,
  searchIconStyle,
  inputStyle,
  clearBtnStyle,
  clearIconStyle,
  emptyStateStyle,
  loadingContainerStyle,
  loadingSpinnerStyle,
  footerStyle,
  COMMAND_ROW_HEIGHT,
  FILE_ROW_HEIGHT,
  ASSISTANT_ROW_HEIGHT,
  SECTION_HEADER_HEIGHT,
  LOADING_ROW_HEIGHT,
  type CommandPaletteProps,
  type PaletteItem,
  type VirtualRow,
} from './command-palette-helpers';

type PaletteMode = 'files' | 'assistant';

// ── Main Component ──────────────────────────────────────────────────────────

const CommandPaletteInner = ({
  isOpen,
  onClose,
  onFileSelect,
  currentPath,
}: CommandPaletteProps) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<PaletteMode>('files');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [fileResults, setFileResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Deferred query for filtering - input stays responsive while filtering catches up
  const deferredQuery = useDeferredValue(query);

  const isAssistantMode = mode === 'assistant';
  const effectiveQuery = deferredQuery.trim();

  // Load recent files when palette opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setMode('files');
      setSelectedIndex(0);
      setFileResults([]);
      // Fetch recent files from backend
      TauriAPI.getRecentFiles(10)
        .then((files) => {
          setRecentFiles(files);
        })
        .catch(() => {
          setRecentFiles([]);
        });
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Build the flat item list for keyboard navigation
  const paletteItems = useMemo((): PaletteItem[] => {
    const items: PaletteItem[] = [];
    const isEmptyQuery = !effectiveQuery;

    if (isAssistantMode) {
      if (effectiveQuery) {
        items.push({
          type: 'assistant',
          prompt: effectiveQuery,
          sectionLabel: t('commandPalette.askWisp'),
        });
      }
    } else if (isEmptyQuery) {
      // Recent Files section
      if (recentFiles.length > 0) {
        recentFiles.forEach((file, i) => {
          items.push({
            type: 'recent-file',
            file,
            sectionLabel: i === 0 ? t('commandPalette.recentFiles') : undefined,
          });
        });
      }
    } else {
      // If the query looks like a path, offer a "Go to folder" item at the top
      const trimmedQ = effectiveQuery;
      const looksLikePath =
        trimmedQ.startsWith('/') ||
        trimmedQ.startsWith('~') ||
        /^[A-Za-z]:[/\\]/.test(trimmedQ) ||
        trimmedQ.startsWith('wisp://');
      if (looksLikePath && onFileSelect) {
        items.push({
          type: 'go-to-path',
          path: trimmedQ,
          sectionLabel: t('commandPalette.goToCategory'),
        });
      }
    }

    return items;
  }, [effectiveQuery, isAssistantMode, recentFiles, onFileSelect, t]);

  // Show file results only when a query is typed and there are results
  const showFileResults = !isAssistantMode && effectiveQuery.length >= 2 && fileResults.length > 0;
  const totalItems = paletteItems.length + (showFileResults ? fileResults.length : 0);

  // Build flat virtual rows for the virtualizer
  const virtualRows = useMemo((): VirtualRow[] => {
    const rows: VirtualRow[] = [];
    let itemIndex = 0;

    for (const item of paletteItems) {
      if (item.sectionLabel) {
        rows.push({ kind: 'section-header', label: item.sectionLabel });
      }
      if (item.type === 'go-to-path') {
        rows.push({ kind: 'go-to-path', path: item.path, itemIndex });
      } else if (item.type === 'recent-file') {
        rows.push({ kind: 'recent-file', file: item.file, itemIndex });
      } else {
        rows.push({ kind: 'assistant', prompt: item.prompt, itemIndex });
      }
      itemIndex++;
    }

    if (showFileResults) {
      rows.push({ kind: 'section-header', label: t('commandPalette.filesAndFolders') });
      for (const result of fileResults) {
        rows.push({ kind: 'search-file', result, itemIndex });
        itemIndex++;
      }
    }

    if (isSearching) {
      rows.push({ kind: 'loading' });
    }

    return rows;
  }, [paletteItems, showFileResults, fileResults, isSearching, t]);

  // Estimate row height for virtualizer
  const estimateSize = useCallback(
    (index: number) => {
      const row = virtualRows[index];
      if (!row) return COMMAND_ROW_HEIGHT;
      switch (row.kind) {
        case 'section-header':
          return SECTION_HEADER_HEIGHT;
        case 'go-to-path':
          return COMMAND_ROW_HEIGHT;
        case 'recent-file':
          return FILE_ROW_HEIGHT;
        case 'search-file':
          return FILE_ROW_HEIGHT;
        case 'assistant':
          return ASSISTANT_ROW_HEIGHT;
        case 'loading':
          return LOADING_ROW_HEIGHT;
        default:
          return COMMAND_ROW_HEIGHT;
      }
    },
    [virtualRows],
  );

  // Virtualizer
  const virtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => listRef.current,
    estimateSize,
    overscan: 8,
  });

  // Reset selection when effective query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [effectiveQuery, isAssistantMode]);

  // Search files when query has no good command matches (skip in command mode)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const q = query.trim();
    if (!q || q.length < 2 || isAssistantMode) {
      setFileResults([]);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        let results: SearchResult[] = [];
        try {
          const enhanced = await TauriAPI.enhancedSearch(q, undefined, 10);
          results = enhanced.results;
        } catch {
          try {
            results = await TauriAPI.searchTokens(q, 10);
          } catch {
            /* ignore */
          }
        }
        if (results.length === 0 && currentPath && !currentPath.startsWith('wisp://')) {
          try {
            const paths = await TauriAPI.findFiles(q, currentPath);
            results = paths.slice(0, 10).map((p) => ({
              path: p,
              filename: p.split(/[/\\]/).pop() || p,
              matches: [],
              score: 1,
              relevance_type: 'filesystem',
            }));
          } catch {
            /* ignore */
          }
        }
        setFileResults(results);
      } catch {
        setFileResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 200);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [query, currentPath, isAssistantMode]);

  // Scroll selected item into view via virtualizer
  useEffect(() => {
    // Find the virtual row index that corresponds to the selected itemIndex
    const rowIndex = virtualRows.findIndex(
      (row) =>
        row.kind !== 'section-header' && row.kind !== 'loading' && row.itemIndex === selectedIndex,
    );
    if (rowIndex >= 0) {
      virtualizer.scrollToIndex(rowIndex, { align: 'auto' });
    }
  }, [selectedIndex, virtualRows, virtualizer]);

  const executeItem = useCallback(
    (index: number) => {
      if (index < paletteItems.length) {
        const item = paletteItems[index];
        if (item.type === 'go-to-path') {
          const path = item.path;
          onClose();
          if (onFileSelect) {
            requestAnimationFrame(() => {
              onFileSelect(path, true);
            });
          }
        } else if (item.type === 'recent-file') {
          onClose();
          if (onFileSelect) {
            const hasExt = item.file.name.includes('.') && !item.file.name.startsWith('.');
            requestAnimationFrame(() => {
              onFileSelect(item.file.path, !hasExt);
            });
          }
        } else {
          onClose();
          requestAnimationFrame(() => {
            window.dispatchEvent(
              new CustomEvent('wisp-ai-chat-request', {
                detail: { prompt: item.prompt, currentPath },
              }),
            );
          });
        }
      } else {
        // It's a search file result
        const fileIndex = index - paletteItems.length;
        const file = fileResults[fileIndex];
        if (file && onFileSelect) {
          onClose();
          const hasExt = file.filename.includes('.') && !file.filename.startsWith('.');
          requestAnimationFrame(() => {
            onFileSelect(file.path, !hasExt);
          });
        }
      }
    },
    [paletteItems, fileResults, onClose, onFileSelect, currentPath],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev < totalItems - 1 ? prev + 1 : 0));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : totalItems - 1));
          break;
        case 'Enter':
          e.preventDefault();
          executeItem(selectedIndex);
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'Tab':
          e.preventDefault();
          if (e.shiftKey) {
            setSelectedIndex((prev) => (prev > 0 ? prev - 1 : totalItems - 1));
          } else {
            setSelectedIndex((prev) => (prev < totalItems - 1 ? prev + 1 : 0));
          }
          break;
      }
    },
    [totalItems, selectedIndex, executeItem, onClose],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  const stopPropagation = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const clearQuery = useCallback(() => {
    setQuery('');
  }, []);

  const handleQueryChange = useCallback((value: string) => {
    if (value.startsWith('?')) {
      setMode('assistant');
      setQuery(value.slice(1).trimStart());
      return;
    }
    setQuery(value);
  }, []);

  const switchMode = useCallback((nextMode: PaletteMode) => {
    setMode(nextMode);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const activeMode = mode;
  const locationLabel = useMemo(() => {
    if (!currentPath) return t('commandPalette.everywhere');
    if (currentPath === 'wisp://home') return t('sidebar.home');
    return (
      currentPath
        .replace(/[/\\]+$/, '')
        .split(/[/\\]/)
        .pop() || currentPath
    );
  }, [currentPath, t]);

  if (!isOpen) return null;

  // ── Render a single virtual row ──────────────────────────────────────────

  const renderVirtualRow = (row: VirtualRow) => {
    switch (row.kind) {
      case 'section-header':
        return <div style={sectionHeaderStyle}>{row.label}</div>;

      case 'go-to-path': {
        const isSelected = row.itemIndex === selectedIndex;
        return (
          <button
            id={`command-palette-option-${row.itemIndex}`}
            role="option"
            aria-selected={isSelected}
            data-index={row.itemIndex}
            style={isSelected ? itemSelectedStyle : itemBaseStyle}
            onClick={() => executeItem(row.itemIndex)}
            onMouseEnter={() => setSelectedIndex(row.itemIndex)}
          >
            <span style={iconWrapStyle}>
              <Folder size={14} />
            </span>
            <span style={fileNameContainerStyle}>
              <span style={fileNameStyle}>
                {t('commandPalette.goToFolder', { path: row.path })}
              </span>
            </span>
            <span style={shortcutStyle}>Enter</span>
          </button>
        );
      }

      case 'recent-file': {
        const rf = row.file;
        const hasExt = rf.name.includes('.') && !rf.name.startsWith('.');
        const isDir = !hasExt;
        const parentPath = rf.path.replace(/[/\\][^/\\]+$/, '');
        const isSelected = row.itemIndex === selectedIndex;
        return (
          <button
            id={`command-palette-option-${row.itemIndex}`}
            role="option"
            aria-selected={isSelected}
            data-index={row.itemIndex}
            style={isSelected ? itemSelectedStyle : itemBaseStyle}
            onClick={() => executeItem(row.itemIndex)}
            onMouseEnter={() => setSelectedIndex(row.itemIndex)}
          >
            <span style={iconWrapStyle}>{isDir ? <Folder size={14} /> : <File size={14} />}</span>
            <span style={fileNameContainerStyle}>
              <span style={fileNameStyle}>{rf.name}</span>
              <span style={filePathStyle}>{parentPath}</span>
            </span>
            <span style={timestampStyle}>{formatTimestamp(rf.accessed_at * 1000)}</span>
          </button>
        );
      }

      case 'search-file': {
        const result = row.result;
        const hasExt = result.filename.includes('.') && !result.filename.startsWith('.');
        const isDir = !hasExt;
        const parentPath = result.path.replace(/[/\\][^/\\]+$/, '');
        const isSelected = row.itemIndex === selectedIndex;
        return (
          <button
            id={`command-palette-option-${row.itemIndex}`}
            role="option"
            aria-selected={isSelected}
            data-index={row.itemIndex}
            style={isSelected ? itemSelectedStyle : itemBaseStyle}
            onClick={() => executeItem(row.itemIndex)}
            onMouseEnter={() => setSelectedIndex(row.itemIndex)}
          >
            <span style={iconWrapStyle}>{isDir ? <Folder size={14} /> : <File size={14} />}</span>
            <span style={fileNameContainerStyle}>
              <span style={fileNameStyle}>{result.filename}</span>
              <span style={filePathStyle}>{parentPath}</span>
            </span>
            <span style={timestampStyle}>
              {isDir ? t('commandPalette.folderType') : t('commandPalette.fileType')}
            </span>
          </button>
        );
      }

      case 'assistant': {
        const isSelected = row.itemIndex === selectedIndex;
        return (
          <button
            id={`command-palette-option-${row.itemIndex}`}
            role="option"
            aria-selected={isSelected}
            data-index={row.itemIndex}
            style={isSelected ? itemSelectedStyle : itemBaseStyle}
            onClick={() => executeItem(row.itemIndex)}
            onMouseEnter={() => setSelectedIndex(row.itemIndex)}
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-xp-purple/15 text-xp-purple"
              aria-hidden="true"
            >
              <Sparkles size={16} />
            </span>
            <span style={fileNameContainerStyle}>
              <span style={fileNameStyle}>
                {t('commandPalette.askWispWithPrompt', { prompt: row.prompt })}
              </span>
              <span style={filePathStyle}>{t('commandPalette.askWispDescription')}</span>
            </span>
            <span style={shortcutStyle}>Enter</span>
          </button>
        );
      }

      case 'loading':
        return (
          <div style={loadingContainerStyle}>
            <div style={loadingSpinnerStyle} />
            {t('commandPalette.searchingFiles')}
          </div>
        );
    }
  };

  const hasContent = virtualRows.length > 0;

  let SearchModeIcon = Search;
  let placeholderKey: 'commandPalette.placeholder' | 'commandPalette.assistantPlaceholder' =
    'commandPalette.placeholder';
  if (activeMode === 'assistant') {
    SearchModeIcon = Sparkles;
    placeholderKey = 'commandPalette.assistantPlaceholder';
  }

  const renderResultsContent = () => {
    if (!hasContent && !isSearching) {
      if (isAssistantMode && !effectiveQuery) {
        return (
          <div className="flex flex-col items-center px-8 py-10 text-center">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-xp-purple/15 text-xp-purple ring-1 ring-xp-purple/20">
              <Sparkles size={20} aria-hidden="true" />
            </span>
            <div className="text-sm font-medium text-xp-text">
              {t('commandPalette.assistantEmptyTitle')}
            </div>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-xp-text-muted">
              {t('commandPalette.assistantEmptyDescription')}
            </p>
          </div>
        );
      }
      return <div style={emptyStateStyle}>{t('commandPalette.noResults')}</div>;
    }

    return (
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = virtualRows[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderVirtualRow(row)}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={backdropStyle} onClick={handleBackdropClick} data-command-palette>
      <div
        style={dialogStyle}
        onClick={stopPropagation}
        role="dialog"
        aria-modal="true"
        aria-label={t('commandPalette.title')}
      >
        <div className="flex items-center justify-between border-b border-xp-border px-[18px] py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-xp-purple/15 text-xp-purple ring-1 ring-xp-purple/20"
              aria-hidden="true"
            >
              <Sparkles size={17} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight text-xp-text">
                {t('commandPalette.title')}
              </div>
              <div className="truncate text-[11px] text-xp-text-muted">
                {t('commandPalette.subtitle')}
              </div>
            </div>
          </div>
          <span className="ml-4 max-w-[180px] truncate rounded border border-xp-border bg-xp-bg px-2.5 py-1 text-[10px] text-xp-text-muted">
            {locationLabel}
          </span>
        </div>

        <div
          className="flex items-center gap-1 px-[18px] pt-3"
          role="tablist"
          aria-label={t('commandPalette.modeLabel')}
        >
          {(
            [
              ['files', Files, t('commandPalette.modes.files')],
              ['assistant', Sparkles, t('commandPalette.modes.assistant')],
            ] as const
          ).map(([mode, Icon, label]) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={activeMode === mode}
              onClick={() => switchMode(mode)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                activeMode === mode
                  ? 'bg-xp-purple/15 text-xp-purple ring-1 ring-inset ring-xp-purple/20'
                  : 'text-xp-text-muted hover:bg-xp-surface-light hover:text-xp-text'
              }`}
            >
              <Icon size={13} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div style={searchBarStyle}>
          <SearchModeIcon style={searchIconStyle} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t(placeholderKey)}
            style={inputStyle}
            autoComplete="off"
            spellCheck={false}
            aria-controls="command-palette-results"
            aria-activedescendant={
              totalItems > 0 ? `command-palette-option-${selectedIndex}` : undefined
            }
          />
          {effectiveQuery && (
            <button
              type="button"
              onClick={clearQuery}
              style={clearBtnStyle}
              aria-label={t('commandPalette.clear')}
            >
              <X style={clearIconStyle} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Results List - Virtualized */}
        <div
          ref={listRef}
          id="command-palette-results"
          role="listbox"
          style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}
        >
          {renderResultsContent()}
        </div>

        {/* Footer hint */}
        <div style={footerStyle}>
          <span>
            <kbd style={kbdStyle}>&#8593;&#8595;</kbd> {t('commandPalette.navigate')}
          </span>
          <span>
            <kbd style={kbdStyle}>Enter</kbd> {t('commandPalette.selectAction')}
          </span>
          <span>
            <kbd style={kbdStyle}>Esc</kbd> {t('commandPalette.closeAction')}
          </span>
        </div>
      </div>
    </div>
  );
};

export default React.memo(CommandPaletteInner);
