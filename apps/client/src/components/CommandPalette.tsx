import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Copy, File, Folder, FolderOpen, Globe, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TauriAPI, type RecentFile } from '@/lib/tauri-api';
import {
  matchesSearchKind,
  searchGlobalFiles,
  type GlobalFileResult,
  type GlobalSearchKind,
} from '@/lib/global-file-search';
import { isBrowserDemoMode } from '@/lib/browser-demo-files';
import { addressToWebUrl } from '@/lib/address-url';
import { parentDirectory } from '@/lib/recent-entry-actions';
import { Dialog, DialogTitle } from '@/components/ui/dialog';
import {
  FILE_ROW_HEIGHT,
  RECENT_CANDIDATE_LIMIT,
  RECENT_DISPLAY_LIMIT,
  SEARCH_KINDS,
  isPathQuery,
  type CommandPaletteProps,
  type PaletteEntry,
  type SearchSelectionIntent,
} from './command-palette-helpers';
import './command-palette.css';

const CommandPaletteInner = ({ isOpen, onClose, onFileSelect }: CommandPaletteProps) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<GlobalSearchKind>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [fileResults, setFileResults] = useState<GlobalFileResult[]>([]);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [searchPartial, setSearchPartial] = useState(false);
  const [searchLimited, setSearchLimited] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchGeneration = useRef(0);
  const copyGeneration = useRef(0);
  const copyMounted = useRef(false);
  const activePathRef = useRef<string | undefined>(undefined);
  const effectiveQuery = query.trim();
  const isDemo = isBrowserDemoMode();

  const directEntry = useMemo((): PaletteEntry | null => {
    if (!effectiveQuery) return null;
    const web = /^https?:\/\//i.test(effectiveQuery) ? addressToWebUrl(effectiveQuery) : null;
    if (web) {
      return {
        path: web,
        name: t('commandPalette.openWebsite', { url: web, defaultValue: 'Open {{url}}' }),
        isDir: true,
        source: 'web',
      };
    }
    if (!isPathQuery(effectiveQuery)) return null;
    return {
      path: effectiveQuery,
      name: t('commandPalette.openPath', { defaultValue: 'Open this path' }),
      isDir: effectiveQuery.startsWith('wisp://') ? true : undefined,
      source: 'path',
    };
  }, [effectiveQuery, t]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let recentGeneration = 0;
    setQuery('');
    setKind('all');
    setSelectedIndex(0);
    setFileResults([]);
    setRecentFiles([]);
    const loadRecent = () => {
      const generation = ++recentGeneration;
      setLoadingRecent(true);
      TauriAPI.getRecentFiles(RECENT_CANDIDATE_LIMIT)
        .then((files) => {
          if (!cancelled && generation === recentGeneration) setRecentFiles(files);
        })
        .catch(() => {
          if (!cancelled && generation === recentGeneration) setRecentFiles([]);
        })
        .finally(() => {
          if (!cancelled && generation === recentGeneration) setLoadingRecent(false);
        });
    };
    loadRecent();
    window.addEventListener('recent-files-changed', loadRecent);
    return () => {
      cancelled = true;
      window.removeEventListener('recent-files-changed', loadRecent);
    };
  }, [isOpen]);

  // The shared Dialog restores normal focus. A removed or now-hidden opener
  // needs the visible titlebar trigger after a responsive layout change.
  useEffect(() => {
    if (!isOpen) return;
    copyMounted.current = true;
    const previous = document.activeElement;
    return () => {
      copyMounted.current = false;
      requestAnimationFrame(() => {
        const visible = (element: HTMLElement) =>
          element.isConnected && element.getClientRects().length > 0;
        const target =
          previous instanceof HTMLElement && previous !== document.body && visible(previous)
            ? previous
            : Array.from(
                document.querySelectorAll<HTMLElement>('[data-command-palette-trigger]'),
              ).find(visible);
        target?.focus({ preventScroll: true });
      });
    };
  }, [isOpen]);

  useEffect(() => {
    const generation = ++searchGeneration.current;
    const controller = new AbortController();
    setSelectedIndex(0);
    setFileResults([]);
    setSearchPartial(false);
    setSearchLimited(false);
    setIsSearching(false);
    if (!isOpen || !effectiveQuery || directEntry) return () => controller.abort();
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        await searchGlobalFiles(
          effectiveQuery,
          ({ results, partial, limited }) => {
            if (generation !== searchGeneration.current || controller.signal.aborted) return;
            const previousPath = activePathRef.current;
            setFileResults(results);
            setSearchPartial(partial);
            setSearchLimited(limited);
            if (previousPath) {
              const index = results.findIndex((result) => result.path === previousPath);
              if (index >= 0) setSelectedIndex(index);
            }
          },
          { kind, signal: controller.signal },
        );
      } catch {
        if (generation === searchGeneration.current && !controller.signal.aborted) {
          setSearchPartial(true);
        }
      } finally {
        if (generation === searchGeneration.current && !controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [effectiveQuery, kind, isOpen, directEntry]);

  const entries = useMemo((): PaletteEntry[] => {
    if (directEntry) return [directEntry];
    if (effectiveQuery) {
      return fileResults.map((result) => ({
        path: result.path,
        name: result.filename,
        isDir: result.isDir,
        source: 'search',
      }));
    }
    const seen = new Set<string>();
    return recentFiles
      .filter((file) => {
        const isDir = file.file_type.trim().toLowerCase() === 'folder';
        if (seen.has(file.path) || !matchesSearchKind(isDir, kind)) return false;
        seen.add(file.path);
        return true;
      })
      .slice(0, RECENT_DISPLAY_LIMIT)
      .map((file) => ({
        path: file.path,
        name: file.name,
        isDir: file.file_type.trim().toLowerCase() === 'folder',
        source: 'recent',
      }));
  }, [directEntry, effectiveQuery, fileResults, recentFiles, kind]);
  const safeIndex = Math.min(Math.max(selectedIndex, 0), Math.max(entries.length - 1, 0));
  const selectedEntry = entries[safeIndex];

  useEffect(() => {
    activePathRef.current = selectedEntry?.path;
    copyGeneration.current++;
    setCopyState('idle');
  }, [selectedEntry?.path]);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => FILE_ROW_HEIGHT,
    getItemKey: (index) => entries[index].path,
    overscan: 6,
  });
  useEffect(() => {
    if (entries.length) virtualizer.scrollToIndex(safeIndex, { align: 'auto' });
  }, [safeIndex, entries.length, virtualizer]);

  const executeEntry = useCallback(
    (entry: PaletteEntry | undefined, intent: SearchSelectionIntent = 'open') => {
      if (!entry || !onFileSelect) return;
      if (intent === 'reveal' && /^(https?:|wisp:)/i.test(entry.path)) return;
      onClose();
      requestAnimationFrame(() => onFileSelect(entry.path, entry.isDir, intent));
    },
    [onClose, onFileSelect],
  );
  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!entries.length) return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setSelectedIndex((safeIndex + delta + entries.length) % entries.length);
    } else if (event.key === 'Enter' && selectedEntry) {
      event.preventDefault();
      executeEntry(selectedEntry, event.metaKey || event.ctrlKey ? 'reveal' : 'open');
    }
  };
  const copySelectedPath = async () => {
    if (!selectedEntry) return;
    const generation = ++copyGeneration.current;
    try {
      await navigator.clipboard.writeText(selectedEntry.path);
      if (copyMounted.current && generation === copyGeneration.current) setCopyState('copied');
    } catch {
      if (copyMounted.current && generation === copyGeneration.current) setCopyState('failed');
    }
  };

  const kindLabels: Record<GlobalSearchKind, string> = {
    all: t('commandPalette.filterAll', { defaultValue: 'All' }),
    files: t('commandPalette.filterFiles', { defaultValue: 'Files' }),
    folders: t('commandPalette.filterFolders', { defaultValue: 'Folders' }),
  };
  const searching = isSearching || (!effectiveQuery && loadingRecent);
  const canReveal = selectedEntry && !/^(https?:|wisp:)/i.test(selectedEntry.path);
  let emptyTitle = t('commandPalette.noResults', { defaultValue: 'No matching files' });
  let emptyDescription = t('commandPalette.tryAnotherName', {
    defaultValue: 'Try a different name.',
  });
  if (!effectiveQuery) {
    emptyTitle = t('commandPalette.noRecentVisits', { defaultValue: 'No recent items yet' });
    emptyDescription = t('commandPalette.startTyping', {
      defaultValue: 'Type a name to find a file or folder.',
    });
  } else if (searchPartial) {
    emptyTitle = t('commandPalette.searchUnavailable', {
      defaultValue: 'Search is unavailable. Please try again shortly.',
    });
    emptyDescription = '';
  } else if (searchLimited) {
    emptyTitle = t('commandPalette.narrowSearch', { defaultValue: 'Try a more specific name' });
    emptyDescription = t('commandPalette.searchBudgetReached', {
      defaultValue: 'This search reached its limit before finding this type of item.',
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()} maxWidth="720px">
      <div
        className="wisp-search-dialog"
        data-command-palette
        style={
          {
            '--wisp-search-height': `${Math.max(4, Math.min(8, entries.length)) * FILE_ROW_HEIGHT + 190}px`,
          } as React.CSSProperties
        }
      >
        <DialogTitle className="sr-only">
          {t('commandPalette.searchTitle', { defaultValue: 'Search files and folders' })}
        </DialogTitle>
        <div className="wisp-search-input-row">
          <Search size={21} aria-hidden="true" />
          <input
            id="command-palette-input"
            ref={inputRef}
            data-autofocus
            type="text"
            role="combobox"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={t('commandPalette.placeholder', {
              defaultValue: 'Search files and folders...',
            })}
            aria-label={t('commandPalette.placeholder', {
              defaultValue: 'Search files and folders...',
            })}
            autoComplete="off"
            spellCheck={false}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-controls="command-palette-results"
            aria-activedescendant={
              selectedEntry ? `command-palette-option-${safeIndex}` : undefined
            }
          />
          {query && (
            <button
              type="button"
              className="wisp-search-icon-button"
              aria-label={t('commandPalette.clear', { defaultValue: 'Clear search' })}
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="wisp-search-close"
            onClick={onClose}
            aria-label={t('commandPalette.closeSearch', { defaultValue: 'Close search' })}
          >
            Esc
          </button>
        </div>
        <div className="wisp-search-filter-row">
          <div
            className="wisp-search-tabs"
            role="tablist"
            aria-label={t('commandPalette.itemType', { defaultValue: 'Item type' })}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const index = SEARCH_KINDS.indexOf(kind);
              let next = (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
              if (event.key === 'Home') next = 0;
              if (event.key === 'End') next = 2;
              const nextKind = SEARCH_KINDS[next];
              setKind(nextKind);
              event.currentTarget
                .querySelector<HTMLButtonElement>(`[data-kind="${nextKind}"]`)
                ?.focus();
            }}
          >
            {SEARCH_KINDS.map((value) => (
              <button
                key={value}
                id={`command-palette-tab-${value}`}
                type="button"
                role="tab"
                data-kind={value}
                aria-selected={kind === value}
                aria-controls="command-palette-panel"
                tabIndex={kind === value ? 0 : -1}
                onClick={() => setKind(value)}
              >
                {kindLabels[value]}
              </button>
            ))}
          </div>
          <span className="wisp-search-scope">
            {isDemo
              ? t('commandPalette.exampleFiles', { defaultValue: 'Example files · name search' })
              : t('commandPalette.systemLocations', {
                  defaultValue: 'System-searchable locations · names',
                })}
          </span>
        </div>
        <div
          id="command-palette-panel"
          role="tabpanel"
          aria-labelledby={`command-palette-tab-${kind}`}
          className="wisp-search-results-panel"
        >
          <div className="wisp-search-section-label" aria-live="polite">
            {!effectiveQuery
              ? t('commandPalette.recentVisits', { defaultValue: 'Recently visited' })
              : t('commandPalette.results', { defaultValue: 'Search results' })}
            {entries.length > 0 && (
              <span>
                {entries.length}
                {searchLimited ? '+' : ''}
              </span>
            )}
          </div>
          <div
            ref={listRef}
            id="command-palette-results"
            role="listbox"
            aria-label={t('commandPalette.results', { defaultValue: 'Search results' })}
            aria-busy={searching}
            className="wisp-search-results"
          >
            {entries.length > 0 ? (
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map((row) => {
                  const entry = entries[row.index];
                  let Icon = File;
                  if (entry.isDir) Icon = Folder;
                  if (entry.source === 'path') Icon = FolderOpen;
                  if (entry.source === 'web') Icon = Globe;
                  return (
                    <button
                      key={row.key}
                      id={`command-palette-option-${row.index}`}
                      role="option"
                      aria-selected={row.index === safeIndex}
                      type="button"
                      tabIndex={-1}
                      className="wisp-search-result"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        transform: `translateY(${row.start}px)`,
                      }}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setSelectedIndex(row.index)}
                      onClick={() => executeEntry(entry)}
                    >
                      <span className={`wisp-search-result-icon ${entry.isDir ? 'is-folder' : ''}`}>
                        <Icon size={22} aria-hidden="true" />
                      </span>
                      <span className="wisp-search-result-text">
                        <span className="wisp-search-result-name">{entry.name}</span>
                        <span className="wisp-search-result-parent" title={entry.path}>
                          {entry.source === 'path' || entry.source === 'web'
                            ? entry.path
                            : parentDirectory(entry.path)}
                        </span>
                      </span>
                      {row.index === safeIndex && (
                        <span className="wisp-search-enter" aria-hidden="true">
                          ↵
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="wisp-search-empty" role="status" aria-live="polite">
                {searching ? (
                  <>
                    <span className="wisp-search-spinner" aria-hidden="true" />
                    {t('commandPalette.searchingFiles', { defaultValue: 'Searching files...' })}
                  </>
                ) : (
                  <>
                    <Search size={28} aria-hidden="true" />
                    <strong>{emptyTitle}</strong>
                    {emptyDescription && <p>{emptyDescription}</p>}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        {selectedEntry && (
          <div className="wisp-search-selection">
            <div className="wisp-search-full-path" title={selectedEntry.path}>
              <span>{t('commandPalette.fullPath', { defaultValue: 'Full path' })}</span>
              <div>{selectedEntry.path}</div>
            </div>
            <div className="wisp-search-selection-actions">
              <span role="status" className="wisp-search-copy-status">
                {copyState === 'copied' &&
                  t('commandPalette.pathCopied', { defaultValue: 'Path copied' })}
                {copyState === 'failed' &&
                  t('commandPalette.copyFailed', { defaultValue: 'Could not copy path' })}
              </span>
              <button
                type="button"
                onClick={copySelectedPath}
                className="wisp-search-secondary-action"
              >
                <Copy size={14} aria-hidden="true" />
                {t('commandPalette.copyPath', { defaultValue: 'Copy path' })}
              </button>
              {canReveal && (
                <button
                  type="button"
                  onClick={() => executeEntry(selectedEntry, 'reveal')}
                  className="wisp-search-secondary-action"
                >
                  <FolderOpen size={14} aria-hidden="true" />
                  {t('commandPalette.reveal', { defaultValue: 'Show in folder' })}
                </button>
              )}
              <button
                type="button"
                onClick={() => executeEntry(selectedEntry)}
                className="wisp-search-primary-action"
              >
                {selectedEntry.isDir === true && selectedEntry.source !== 'web'
                  ? t('commandPalette.openFolder', { defaultValue: 'Open folder' })
                  : t('commandPalette.openItem', { defaultValue: 'Open' })}
              </button>
            </div>
          </div>
        )}
        {(searchPartial || searchLimited) && entries.length > 0 && (
          <p role="status" className="wisp-search-notice">
            {searchPartial
              ? t('commandPalette.partialResults', {
                  defaultValue: 'Some locations could not be searched.',
                })
              : t('commandPalette.refineForMore', {
                  defaultValue: 'Showing a limited set. Add more of the name to narrow the search.',
                })}
          </p>
        )}
        <div className="wisp-search-footer">
          <span>
            <kbd>↑↓</kbd> {t('commandPalette.navigate', { defaultValue: 'Navigate' })}
          </span>
          <span>
            <kbd>↵</kbd> {t('commandPalette.openItem', { defaultValue: 'Open' })}
          </span>
          <span>
            <kbd>{navigator.platform.toUpperCase().includes('MAC') ? '⌘' : 'Ctrl'} ↵</kbd>{' '}
            {t('commandPalette.reveal', { defaultValue: 'Show in folder' })}
          </span>
        </div>
      </div>
    </Dialog>
  );
};

export default React.memo(CommandPaletteInner);
