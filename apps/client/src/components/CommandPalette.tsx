import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Copy, File, Folder, FolderOpen, Globe, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TauriAPI, type FileEntry, type RecentFile } from '@/lib/tauri-api';
import { searchGlobalFiles, type GlobalFileResult } from '@/lib/global-file-search';
import {
  loadSearchScope,
  parseSearchTokens,
  saveSearchScope,
  type SearchScope,
  type TokenChip,
} from '@/hooks/use-search-tokens';
import { isBrowserDemoMode } from '@/lib/browser-demo-files';
import { addressToWebUrl } from '@/lib/address-url';
import { parentDirectory } from '@/lib/recent-entry-actions';
import { Dialog, DialogTitle } from '@/components/ui/dialog';
import {
  FILE_ROW_HEIGHT,
  RECENT_CANDIDATE_LIMIT,
  RECENT_DISPLAY_LIMIT,
  SEARCH_KIND_CHIPS,
  backendKindForChip,
  isPathQuery,
  matchesKindChip,
  type CommandPaletteProps,
  type PaletteEntry,
  type SearchKindChip,
  type SearchSelectionIntent,
} from './command-palette-helpers';
import './command-palette.css';

const nameExtension = (filename: string): string =>
  filename.includes('.') ? (filename.split('.').pop()?.toLowerCase() ?? '') : '';

const CommandPaletteInner = ({
  isOpen,
  onClose,
  onFileSelect,
  currentPath,
}: CommandPaletteProps) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<SearchKindChip>('all');
  const [scope, setScope] = useState<SearchScope>(loadSearchScope);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [fileResults, setFileResults] = useState<GlobalFileResult[]>([]);
  const [folderFiles, setFolderFiles] = useState<FileEntry[] | null>(null);
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
  // The current-folder scope filters the pane's readDirectory results in the
  // client, so it needs a browsable filesystem path to list.
  const canSearchFolder = !isDemo && !!currentPath && !currentPath.startsWith('wisp://');
  const parsedTokens = useMemo(() => parseSearchTokens(effectiveQuery), [effectiveQuery]);
  const effectiveText = parsedTokens.remainingQuery;

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

  // Current-folder scope: reuse the directory listing the pane already shows
  // (readDirectory) and filter it in the client — no new backend surface.
  useEffect(() => {
    if (!isOpen || scope !== 'folder' || !canSearchFolder || !currentPath) return;
    let cancelled = false;
    setFolderFiles(null);
    TauriAPI.readDirectory(currentPath)
      .then((files) => {
        if (!cancelled) setFolderFiles(files);
      })
      .catch(() => {
        if (!cancelled) setFolderFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, scope, canSearchFolder, currentPath]);

  useEffect(() => {
    const generation = ++searchGeneration.current;
    const controller = new AbortController();
    setSelectedIndex(0);
    setFileResults([]);
    setSearchPartial(false);
    setSearchLimited(false);
    setIsSearching(false);
    if (!isOpen || (scope === 'folder' && canSearchFolder) || !effectiveText || directEntry) {
      return () => controller.abort();
    }
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        await searchGlobalFiles(
          effectiveText,
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
          { kind: backendKindForChip(kind), signal: controller.signal },
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
  }, [effectiveText, kind, isOpen, directEntry, scope, canSearchFolder]);

  const entries = useMemo((): PaletteEntry[] => {
    if (directEntry) return [directEntry];
    if (effectiveQuery) {
      if (scope === 'folder' && canSearchFolder) {
        const needle = effectiveText.toLowerCase();
        return (folderFiles ?? [])
          .filter((file) => {
            if (needle && !file.name.toLowerCase().includes(needle)) return false;
            if (!matchesKindChip(file.is_dir, file.name, kind)) return false;
            if (parsedTokens.extensionFilter.length > 0) {
              if (!parsedTokens.extensionFilter.includes(nameExtension(file.name))) return false;
            }
            if (parsedTokens.sizeMin !== undefined && file.size < parsedTokens.sizeMin)
              return false;
            if (parsedTokens.sizeMax !== undefined && file.size > parsedTokens.sizeMax)
              return false;
            if (parsedTokens.dateAfter !== undefined && file.modified < parsedTokens.dateAfter) {
              return false;
            }
            return true;
          })
          .map((file) => ({
            path: file.path,
            name: file.name,
            isDir: file.is_dir,
            source: 'search',
          }));
      }
      // Global results carry paths only, so extension-derived tokens still
      // refine them; size/date predicates need metadata this scope lacks.
      // Fine kind chips bucket by filename here — an approximation the
      // backend's name index cannot answer (#29).
      return fileResults
        .filter(
          (result) =>
            matchesKindChip(result.isDir, result.filename, kind) &&
            (parsedTokens.extensionFilter.length === 0 ||
              parsedTokens.extensionFilter.includes(nameExtension(result.filename))),
        )
        .map((result) => ({
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
        if (seen.has(file.path) || !matchesKindChip(isDir, file.name, kind)) return false;
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
  }, [
    directEntry,
    effectiveQuery,
    effectiveText,
    fileResults,
    recentFiles,
    kind,
    scope,
    canSearchFolder,
    folderFiles,
    parsedTokens,
  ]);
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

  const kindLabels: Record<SearchKindChip, string> = {
    all: t('commandPalette.filterAll', { defaultValue: 'All' }),
    files: t('commandPalette.filterFiles', { defaultValue: 'Files' }),
    folders: t('commandPalette.filterFolders', { defaultValue: 'Folders' }),
    images: t('commandPalette.filterImages', { defaultValue: 'Images' }),
    videos: t('commandPalette.filterVideos', { defaultValue: 'Videos' }),
    audio: t('commandPalette.filterAudio', { defaultValue: 'Audio' }),
    documents: t('commandPalette.filterDocuments', { defaultValue: 'Documents' }),
    archives: t('commandPalette.filterArchives', { defaultValue: 'Archives' }),
  };
  const searching =
    isSearching ||
    (!effectiveQuery && loadingRecent) ||
    (scope === 'folder' && canSearchFolder && folderFiles === null && !!effectiveQuery);
  const canReveal = selectedEntry && !/^(https?:|wisp:)/i.test(selectedEntry.path);
  const switchScope = (next: SearchScope) => {
    setScope(next);
    saveSearchScope(next);
  };
  const removeToken = (chip: TokenChip) => {
    const token = `${chip.key}:${chip.rawValue}`;
    setQuery((prev) =>
      prev
        .replace(token, '')
        .replace(/\s{2,}/g, ' ')
        .trim(),
    );
  };
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
        {parsedTokens.chips.length > 0 && (
          <div
            className="wisp-search-token-row"
            role="group"
            aria-label={t('commandPalette.tokenFilters', { defaultValue: 'Active filters' })}
          >
            {parsedTokens.chips.map((chip) => {
              const token = `${chip.key}:${chip.rawValue}`;
              return (
                <span key={token} className={`wisp-search-token-chip is-${chip.variant}`}>
                  {token}
                  <button
                    type="button"
                    onClick={() => removeToken(chip)}
                    aria-label={t('commandPalette.removeToken', {
                      token,
                      defaultValue: 'Remove filter {{token}}',
                    })}
                  >
                    <X size={10} aria-hidden="true" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <div className="wisp-search-filter-row">
          <div
            className="wisp-search-tabs wisp-search-kind-chips"
            role="tablist"
            aria-label={t('commandPalette.itemType', { defaultValue: 'Item type' })}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const total = SEARCH_KIND_CHIPS.length;
              const index = SEARCH_KIND_CHIPS.indexOf(kind);
              let next = (index + (event.key === 'ArrowRight' ? 1 : total - 1)) % total;
              if (event.key === 'Home') next = 0;
              if (event.key === 'End') next = total - 1;
              const nextKind = SEARCH_KIND_CHIPS[next];
              setKind(nextKind);
              event.currentTarget
                .querySelector<HTMLButtonElement>(`[data-kind="${nextKind}"]`)
                ?.focus();
            }}
          >
            {SEARCH_KIND_CHIPS.map((value) => (
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
          {canSearchFolder ? (
            <div
              className="wisp-search-tabs wisp-search-scope-toggle"
              role="group"
              aria-label={t('commandPalette.scopeGroup', { defaultValue: 'Search scope' })}
            >
              <button
                type="button"
                aria-pressed={scope === 'folder'}
                onClick={() => switchScope('folder')}
              >
                {t('commandPalette.scopeFolder', { defaultValue: 'Current Folder' })}
              </button>
              <button
                type="button"
                aria-pressed={scope === 'everywhere'}
                onClick={() => switchScope('everywhere')}
              >
                {t('commandPalette.scopeEverywhere', { defaultValue: 'Everywhere' })}
              </button>
            </div>
          ) : (
            <span className="wisp-search-scope">
              {isDemo
                ? t('commandPalette.exampleFiles', { defaultValue: 'Example files · name search' })
                : t('commandPalette.systemLocations', {
                    defaultValue: 'System-searchable locations · names',
                  })}
            </span>
          )}
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
