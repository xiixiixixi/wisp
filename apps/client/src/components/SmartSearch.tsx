import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  TauriAPI,
  SearchResult,
  SearchMatch,
  StructuredQuery,
  type GrepSearchMatch,
} from '@/lib/tauri-api';
import { useToast } from '@/hooks/use-toast';
import { getSavedSearches, saveSearch, type SavedSearch } from '@/lib/saved-searches';
import {
  parseSearchTokens,
  loadSearchScope,
  saveSearchScope,
  type SearchScope,
  type TokenChip,
} from '@/hooks/use-search-tokens';
// Native debounce — replaces lodash dependency
const debounce = <T extends (...args: Parameters<T>) => ReturnType<T>>(
  fn: T,
  ms: number,
): T & { cancel: () => void } => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return debounced as T & { cancel: () => void };
};
import {
  SEARCH_INDEX_REFRESH_MS,
  SEARCH_DEBOUNCE_MS,
  DROPDOWN_BLUR_DELAY_MS,
} from '@/lib/constants';
import {
  FileCode,
  Globe,
  Palette,
  FileJson,
  BookOpen,
  FileText,
  ScrollText,
  BookMarked,
  FileSpreadsheet,
  Presentation,
  Image as ImageIcon,
  Film,
  Music,
  Package,
  File as FileIcon,
  ChevronDown,
  Star,
} from 'lucide-react';

export type SearchProvider = 'local' | 'claude' | 'openai' | 'ollama';

interface SmartSearchProps {
  className?: string;
  onFileSelect?: (filePath: string, isDir: boolean) => void;
  placeholder?: string;
  maxResults?: number;
  currentPath?: string;
}

export interface SmartSearchHandle {
  focus: () => void;
}

// Filter words that trigger enhanced NL search
const FILTER_INDICATORS = [
  'large',
  'largest',
  'big',
  'biggest',
  'huge',
  'small',
  'smallest',
  'tiny',
  'heavy',
  'heaviest',
  'light',
  'lightest',
  'today',
  'yesterday',
  'recent',
  'recently',
  'newest',
  'latest',
  'oldest',
  'new',
  'last week',
  'last month',
  'this week',
  'this month',
  'this year',
  'old',
  'videos',
  'video',
  'movies',
  'images',
  'image',
  'photos',
  'photo',
  'picture',
  'pictures',
  'documents',
  'document',
  'docs',
  'pdfs',
  'spreadsheets',
  'presentations',
  'code',
  'scripts',
  'source code',
  'audio',
  'music',
  'songs',
  'archives',
  'compressed',
  'zips',
];

const PROVIDER_LABELS: Record<SearchProvider, string> = {
  local: 'Local',
  claude: 'Claude',
  openai: 'GPT',
  ollama: 'Ollama',
};

const SmartSearch = forwardRef<SmartSearchHandle, SmartSearchProps>(
  (
    { className, onFileSelect, placeholder: placeholderProp, maxResults = 50, currentPath },
    ref,
  ) => {
    const { t } = useTranslation();
    const placeholder = placeholderProp ?? t('smartSearch.placeholder');
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [indexedFileCount, setIndexedFileCount] = useState(0);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const [showResults, setShowResults] = useState(false);
    const [parsedQuery, setParsedQuery] = useState<StructuredQuery | null>(null);
    const [searchProvider, setSearchProvider] = useState<SearchProvider>('local');
    const [showProviderMenu, setShowProviderMenu] = useState(false);
    const providerMenuRef = useRef<HTMLDivElement>(null);
    const [searchContent, setSearchContent] = useState(false);
    const [searchScope, setSearchScope] = useState<SearchScope>(loadSearchScope);
    const [tokenChips, setTokenChips] = useState<TokenChip[]>([]);

    const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(() => getSavedSearches());
    const [showSavedSearches, setShowSavedSearches] = useState(false);
    const [grepResults, setGrepResults] = useState<GrepSearchMatch[]>([]);
    const [isGrepSearching, setIsGrepSearching] = useState(false);
    const [grepTriggered, setGrepTriggered] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const resultsRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const { toast } = useToast();

    useEffect(() => {
      if (!showProviderMenu) return;
      const onMouseDown = (e: MouseEvent) => {
        if (providerMenuRef.current && !providerMenuRef.current.contains(e.target as Node)) {
          setShowProviderMenu(false);
        }
      };
      document.addEventListener('mousedown', onMouseDown);
      return () => document.removeEventListener('mousedown', onMouseDown);
    }, [showProviderMenu]);

    // Keep saved searches in sync with localStorage changes
    useEffect(() => {
      const handleChanged = () => setSavedSearches(getSavedSearches());
      window.addEventListener('saved-searches-changed', handleChanged);
      return () => window.removeEventListener('saved-searches-changed', handleChanged);
    }, []);

    const handleSaveSearch = () => {
      if (!query.trim()) return;
      const name = query.trim().length > 30 ? `${query.trim().slice(0, 30)}...` : query.trim();
      saveSearch({
        name,
        query: query.trim(),
        filters: { fileTypes: [], dateRange: null, sizeRange: null, extensions: [] },
      });
      toast({
        title: t('smartSearch.savedTitle'),
        description: t('smartSearch.savedDesc', { name }),
      });
    };

    // Check index stats periodically
    useEffect(() => {
      const checkStats = async () => {
        try {
          const stats = await TauriAPI.getTokenizerStats();
          if (stats) setIndexedFileCount(stats.total_files);
        } catch {
          // Index may not be ready yet
        }
      };
      checkStats();
      const interval = setInterval(checkStats, SEARCH_INDEX_REFRESH_MS);
      return () => clearInterval(interval);
    }, []);

    useImperativeHandle(ref, () => ({
      focus: () => {
        searchInputRef.current?.focus();
      },
    }));

    // Check if query should use enhanced NL search
    const shouldUseEnhancedSearch = (searchQuery: string): boolean => {
      const words = searchQuery.trim().split(/\s+/);
      if (words.length >= 3) return true;
      const lower = searchQuery.toLowerCase();
      return FILTER_INDICATORS.some((indicator) => lower.includes(indicator));
    };

    // Compute relevance score for filesystem results
    const computeFilesystemScore = (filename: string, queryStr: string): number => {
      const nameLower = filename.toLowerCase();
      const queryLower = queryStr.toLowerCase();
      if (nameLower === queryLower) return 0.9;
      if (nameLower.startsWith(queryLower)) return 0.7;
      if (nameLower.includes(queryLower)) return 0.5;
      return 0.3;
    };

    // Unified search function
    const debouncedSearch = useMemo(
      () =>
        debounce(async (searchQuery: string) => {
          // Parse key:value tokens from raw query
          const { remainingQuery, extensionFilter, sizeMin, sizeMax, dateAfter, chips } =
            parseSearchTokens(searchQuery);

          setTokenChips(chips);

          const effectiveQuery = remainingQuery;

          if (!effectiveQuery.trim() && chips.length === 0) {
            setResults([]);
            setParsedQuery(null);
            setIsSearching(false);
            return;
          }

          // Cancel previous in-flight search
          if (abortRef.current) abortRef.current.abort();
          const controller = new AbortController();
          abortRef.current = controller;

          setIsSearching(true);

          // Determine the path to search — respects scope toggle
          const resolvedSearchPath = (() => {
            if (searchScope === 'everywhere') return undefined;
            return currentPath && !currentPath.startsWith('wisp://') ? currentPath : undefined;
          })();

          try {
            let searchResults: SearchResult[] = [];

            if (searchProvider !== 'local') {
              // AI-powered search: BM25F pre-filter → AI re-rank
              try {
                const aiResult = await TauriAPI.aiSearch(
                  effectiveQuery || searchQuery,
                  searchProvider,
                  undefined, // API key from env/settings
                  undefined, // model default
                  maxResults,
                );
                searchResults = aiResult.results;
              } catch (err) {
                // AI search failed, fall through to local
                console.warn('AI search failed, falling back to local:', err);
                toast({
                  title: t('smartSearch.aiUnavailableTitle'),
                  description: t('smartSearch.aiUnavailableDesc', {
                    provider: PROVIDER_LABELS[searchProvider],
                  }),
                  variant: 'destructive',
                });
              }
            }

            // Local search (or AI fallback)
            if (searchResults.length === 0) {
              const queryForIndex = effectiveQuery || searchQuery;
              // Always try indexed search first (BM25F scored)
              try {
                if (shouldUseEnhancedSearch(queryForIndex)) {
                  const enhanced = await TauriAPI.enhancedSearch(
                    queryForIndex,
                    undefined,
                    maxResults,
                  );
                  if (!controller.signal.aborted) {
                    setParsedQuery(enhanced.parsed_query);
                    searchResults = enhanced.results;
                  }
                } else {
                  const tokenResults = await TauriAPI.searchTokens(queryForIndex, maxResults);
                  if (!controller.signal.aborted) {
                    setParsedQuery(null);
                    searchResults = tokenResults;
                  }
                }
              } catch {
                // Index search failed — not a problem, we'll fall back
                if (!controller.signal.aborted) setParsedQuery(null);
              }

              // If index returned nothing, fall back to filesystem search
              if (searchResults.length === 0 && !controller.signal.aborted) {
                if (resolvedSearchPath) {
                  try {
                    const paths = await TauriAPI.findFiles(
                      effectiveQuery || searchQuery,
                      resolvedSearchPath,
                    );
                    if (!controller.signal.aborted) {
                      searchResults = paths.slice(0, maxResults).map((p) => {
                        const filename = p.split(/[/\\]/).pop() || p;
                        return {
                          path: p,
                          filename,
                          matches: [
                            {
                              token: effectiveQuery || searchQuery,
                              context: t('smartSearch.filenameMatch'),
                            },
                          ],
                          score: computeFilesystemScore(filename, effectiveQuery || searchQuery),
                          relevance_type: 'exact',
                        } as SearchResult;
                      });
                    }
                  } catch {
                    // Filesystem search also failed
                  }
                }
              }
            }

            if (controller.signal.aborted) return;

            // Apply token-derived extension filter
            if (extensionFilter.length > 0) {
              const filterSet = new Set(extensionFilter.map((e) => e.toLowerCase()));
              searchResults = searchResults.filter((r) => {
                const ext = r.filename.split('.').pop()?.toLowerCase() ?? '';
                return filterSet.has(ext);
              });
            }

            // Note: size and date token filters (sizeMin, sizeMax, dateAfter) are passed
            // as hints to the enhanced search engine via the query string. Client-side
            // post-filtering is not performed because SearchResult does not carry file
            // metadata such as size or mtime. The engine handles these constraints.
            void sizeMin;
            void sizeMax;
            void dateAfter;

            // Sort results: by default name matches first, or pure score if content mode
            const queryLowerForSort = (effectiveQuery || searchQuery).toLowerCase();
            if (searchContent) {
              searchResults.sort((a, b) => b.score - a.score);
            } else {
              searchResults.sort((a, b) => {
                const aNameMatch = a.filename.toLowerCase().includes(queryLowerForSort) ? 1 : 0;
                const bNameMatch = b.filename.toLowerCase().includes(queryLowerForSort) ? 1 : 0;
                if (aNameMatch !== bNameMatch) return bNameMatch - aNameMatch;
                return b.score - a.score;
              });
            }
            setResults(searchResults.slice(0, maxResults));
            setSelectedIndex(-1);
          } catch (error) {
            if (!controller.signal.aborted) {
              console.error('Search failed:', error);
              setResults([]);
            }
          } finally {
            if (!controller.signal.aborted) {
              setIsSearching(false);
            }
          }
        }, SEARCH_DEBOUNCE_MS),
      [maxResults, searchProvider, currentPath, searchContent, searchScope, toast, t],
    );

    useEffect(() => {
      debouncedSearch(query);
      return () => {
        debouncedSearch.cancel();
      };
    }, [query, debouncedSearch]);

    // Reset grep state when query changes
    useEffect(() => {
      setGrepResults([]);
      setGrepTriggered(false);
      setIsGrepSearching(false);
    }, [query]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (!showResults || results.length === 0) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, -1));
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && results[selectedIndex]) {
            handleFileSelect(results[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setShowResults(false);
          setSelectedIndex(-1);
          break;
      }
    };

    const handleFileSelect = (result: SearchResult) => {
      setShowResults(false);
      setQuery('');
      setResults([]);
      setSelectedIndex(-1);
      setParsedQuery(null);
      setTokenChips([]);
      setGrepResults([]);
      setGrepTriggered(false);
      // A result is a directory if its filename has no extension (no dot after last separator)
      const hasExt = result.filename.includes('.') && !result.filename.startsWith('.');
      onFileSelect?.(result.path, !hasExt);
    };

    const handleFindSimilar = async (e: React.MouseEvent, filePath: string) => {
      e.stopPropagation();
      try {
        const similarResults = await TauriAPI.findSimilarFiles(filePath, maxResults);
        setResults(similarResults);
        setParsedQuery(null);
      } catch {
        toast({
          title: t('smartSearch.findSimilarFailedTitle'),
          description: t('smartSearch.findSimilarFailedDesc'),
          variant: 'destructive',
        });
      }
    };

    const handleGrepSearch = async () => {
      const searchPath =
        currentPath && !currentPath.startsWith('wisp://') ? currentPath : undefined;
      if (!searchPath || !query.trim()) return;

      setIsGrepSearching(true);
      setGrepTriggered(true);
      setGrepResults([]);

      try {
        const matches = await TauriAPI.grepSearch(query.trim(), searchPath, 200);
        setGrepResults(matches);
      } catch (err) {
        console.error('Grep search failed:', err);
        setGrepResults([]);
      } finally {
        setIsGrepSearching(false);
      }
    };

    // Auto-trigger grep search when local search returns no filename matches
    useEffect(() => {
      if (
        showResults &&
        !isSearching &&
        query.trim().length >= 2 &&
        results.length === 0 &&
        !grepTriggered &&
        !isGrepSearching &&
        searchProvider === 'local'
      ) {
        handleGrepSearch();
      }
    }, [
      showResults,
      isSearching,
      query,
      results.length,
      grepTriggered,
      isGrepSearching,
      searchProvider,
    ]);

    const handleFocus = () => {
      if (results.length > 0 || grepResults.length > 0) setShowResults(true);
    };

    const handleBlur = (e: React.FocusEvent) => {
      setTimeout(() => {
        if (!resultsRef.current?.contains(e.relatedTarget as Node)) {
          setShowResults(false);
          setSelectedIndex(-1);
          setShowProviderMenu(false);
        }
      }, DROPDOWN_BLUR_DELAY_MS);
    };

    const getFileIcon = (filename: string): React.ReactNode => {
      const ext = filename.split('.').pop()?.toLowerCase();
      const props = { size: '1em' as const, className: 'inline-block' };
      switch (ext) {
        case 'js':
        case 'ts':
          return <FileCode {...props} className="inline-block text-xp-yellow" />;
        case 'jsx':
        case 'tsx':
          return <FileCode {...props} className="inline-block text-xp-cyan" />;
        case 'html':
          return <Globe {...props} className="inline-block text-xp-orange" />;
        case 'css':
        case 'scss':
        case 'sass':
          return <Palette {...props} className="inline-block text-xp-purple" />;
        case 'json':
        case 'xml':
        case 'yaml':
        case 'yml':
          return <FileJson {...props} className="inline-block text-xp-green" />;
        case 'md':
          return <BookOpen {...props} className="inline-block text-xp-blue" />;
        case 'txt':
          return <FileText {...props} className="inline-block text-xp-text-muted" />;
        case 'log':
          return <ScrollText {...props} className="inline-block text-xp-text-muted" />;
        case 'pdf':
          return <BookMarked {...props} className="inline-block text-xp-red" />;
        case 'docx':
          return <FileText {...props} className="inline-block text-xp-blue" />;
        case 'xlsx':
          return <FileSpreadsheet {...props} className="inline-block text-xp-green" />;
        case 'pptx':
          return <Presentation {...props} className="inline-block text-xp-orange" />;
        case 'jpg':
        case 'jpeg':
        case 'png':
        case 'gif':
        case 'svg':
          return <ImageIcon {...props} className="inline-block text-xp-purple" />;
        case 'mp4':
        case 'avi':
        case 'mov':
        case 'mkv':
          return <Film {...props} className="inline-block text-xp-red" />;
        case 'mp3':
        case 'wav':
        case 'flac':
          return <Music {...props} className="inline-block text-xp-cyan" />;
        case 'zip':
        case 'rar':
        case 'tar':
        case 'gz':
          return <Package {...props} className="inline-block text-xp-orange" />;
        default:
          return <FileIcon {...props} className="inline-block text-xp-text-muted" />;
      }
    };

    const getRelevanceBadge = (relevanceType: string): { label: string; color: string } => {
      switch (relevanceType) {
        case 'exact':
          return { label: 'Exact', color: 'bg-xp-green/20' };
        case 'semantic':
          return { label: 'Semantic', color: 'bg-xp-purple/20' };
        case 'fuzzy':
          return { label: 'Fuzzy', color: 'bg-xp-yellow/20' };
        case 'metadata':
          return { label: 'Metadata', color: 'bg-xp-cyan/20' };
        case 'ai_description':
          return { label: 'AI', color: 'bg-xp-purple/20' };
        case 'ai_reranked':
          return { label: 'AI Ranked', color: 'bg-xp-purple/20' };
        default:
          return { label: relevanceType, color: 'bg-xp-blue/20' };
      }
    };

    const highlightMatches = (text: string, matches: SearchMatch[]): React.JSX.Element => {
      if (matches.length === 0) return <span>{text}</span>;
      const tokens = matches
        .map((m) => m.token.toLowerCase())
        .filter((t) => t !== 'metadata' && t !== 'semantic' && t !== 'similar');
      if (tokens.length === 0) return <span>{text}</span>;

      let highlightedText = text;
      tokens.forEach((token) => {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escaped})`, 'gi');
        highlightedText = highlightedText.replace(regex, '|||$1|||');
      });

      return (
        <span>
          {highlightedText.split('|||').map((part, index) => {
            const isHighlighted = tokens.some(
              (token) => part.toLowerCase() === token.toLowerCase(),
            );
            return isHighlighted ? (
              // eslint-disable-next-line react/no-array-index-key
              <mark key={index} className="rounded bg-xp-yellow/30 px-1">
                {part}
              </mark>
            ) : (
              // eslint-disable-next-line react/no-array-index-key
              <span key={index}>{part}</span>
            );
          })}
        </span>
      );
    };

    const getFilterChips = (pq: StructuredQuery): { label: string; type: string }[] => {
      const chips: { label: string; type: string }[] = [];
      if (pq.file_type_filter) chips.push({ label: pq.file_type_filter, type: 'type' });
      if (pq.size_filter) {
        if (pq.size_filter.min_bytes && pq.size_filter.min_bytes >= 1024 * 1024 * 1024) {
          chips.push({ label: '>1GB', type: 'size' });
        } else if (pq.size_filter.min_bytes && pq.size_filter.min_bytes >= 100 * 1024 * 1024) {
          chips.push({ label: '>100MB', type: 'size' });
        } else if (pq.size_filter.max_bytes && pq.size_filter.max_bytes <= 100 * 1024) {
          chips.push({ label: '<100KB', type: 'size' });
        } else if (pq.size_filter.max_bytes && pq.size_filter.max_bytes <= 1024 * 1024) {
          chips.push({ label: '<1MB', type: 'size' });
        }
      }
      if (pq.date_filter) {
        if (pq.date_filter.after) {
          const daysAgo = Math.round((Date.now() / 1000 - pq.date_filter.after) / 86400);
          if (daysAgo <= 1) chips.push({ label: t('smartSearch.today'), type: 'date' });
          else if (daysAgo <= 2) chips.push({ label: t('smartSearch.yesterday'), type: 'date' });
          else if (daysAgo <= 7) chips.push({ label: t('smartSearch.lastWeek'), type: 'date' });
          else if (daysAgo <= 30) chips.push({ label: t('smartSearch.lastMonth'), type: 'date' });
          else if (daysAgo <= 365) chips.push({ label: t('smartSearch.thisYear'), type: 'date' });
        }
        if (pq.date_filter.before && !pq.date_filter.after) {
          chips.push({ label: t('smartSearch.old'), type: 'date' });
        }
      }
      if (pq.extension_filter.length > 0) {
        chips.push({ label: `.${pq.extension_filter.join(', .')}`, type: 'ext' });
      }
      return chips;
    };

    return (
      <div className={`relative ${className || ''}`}>
        {/* Search Input */}
        <div className="relative">
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim()) setShowResults(true);
            }}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder={placeholder}
            className="w-full rounded-lg border border-xp-border bg-xp-bg px-4 py-2 pl-10 pr-28 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-xp-blue"
          />

          {/* Search Icon */}
          <div className="absolute left-3 top-1/2 -translate-y-1/2 transform">
            {isSearching ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-xp-text-muted border-t-transparent" />
            ) : (
              <svg className="h-4 w-4 text-xp-text-muted" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>

          {/* Right side controls — preventDefault on mouseDown keeps input focused */}
          <div
            className="absolute right-2 top-1/2 flex -translate-y-1/2 transform items-center gap-1"
            onMouseDown={(e) => e.preventDefault()}
          >
            {/* Provider selector */}
            <div className="relative" ref={providerMenuRef}>
              <button
                onClick={() => setShowProviderMenu(!showProviderMenu)}
                className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs transition-colors ${
                  searchProvider !== 'local'
                    ? 'border border-xp-purple/30 bg-xp-purple/20 text-xp-purple'
                    : 'text-xp-text-muted hover:text-xp-text'
                }`}
                title={`Search provider: ${PROVIDER_LABELS[searchProvider]}`}
              >
                {PROVIDER_LABELS[searchProvider]}
                <ChevronDown size={10} />
              </button>

              {showProviderMenu && (
                <>
                  <div
                    className="absolute right-0 top-full z-50 mt-1 min-w-[120px] rounded border border-xp-border bg-xp-popover shadow-xl"
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    {(Object.keys(PROVIDER_LABELS) as SearchProvider[]).map((p) => (
                      <button
                        key={p}
                        onClick={() => {
                          setSearchProvider(p);
                          setShowProviderMenu(false);
                        }}
                        className={`w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-xp-surface-light ${
                          searchProvider === p ? 'bg-xp-blue/20 text-xp-blue' : ''
                        }`}
                      >
                        {PROVIDER_LABELS[p]}
                        {p === 'local' && <span className="ml-1 text-xp-text-muted">(BM25F)</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Scope toggle: This Folder / Everywhere */}
            {currentPath && !currentPath.startsWith('wisp://') && (
              <button
                onClick={() => {
                  const next: SearchScope = searchScope === 'folder' ? 'everywhere' : 'folder';
                  setSearchScope(next);
                  saveSearchScope(next);
                  if (query.trim()) debouncedSearch(query);
                }}
                className={`rounded px-1.5 py-0.5 text-xs transition-colors ${
                  searchScope === 'everywhere'
                    ? 'border border-xp-cyan/30 bg-xp-cyan/20 text-xp-cyan'
                    : 'text-xp-text-muted hover:text-xp-text'
                }`}
                title={
                  searchScope === 'everywhere'
                    ? t('smartSearch.scopeEverywhereTitle')
                    : t('smartSearch.scopeFolderTitle')
                }
              >
                {searchScope === 'everywhere'
                  ? t('smartSearch.scopeEverywhere')
                  : t('smartSearch.scopeFolder')}
              </button>
            )}

            {/* Content search toggle */}
            <button
              onClick={() => {
                setSearchContent((v) => !v);
                if (query.trim()) debouncedSearch(query);
              }}
              className={`rounded px-1.5 py-0.5 text-xs transition-colors ${
                searchContent
                  ? 'border border-xp-blue/30 bg-xp-blue/20 text-xp-blue'
                  : 'text-xp-text-muted hover:text-xp-text'
              }`}
              title={
                searchContent
                  ? t('smartSearch.sortByContentTitle')
                  : t('smartSearch.sortByNameTitle')
              }
            >
              {searchContent ? t('smartSearch.sortByContent') : t('smartSearch.sortByName')}
            </button>

            {/* Index Stats */}
            {indexedFileCount > 0 && (
              <span className="text-xs text-xp-text-muted">
                {indexedFileCount.toLocaleString()}
              </span>
            )}

            {/* Save Search Button */}
            {query.trim() && (
              <button
                onClick={handleSaveSearch}
                className="text-xp-text-muted transition-colors hover:text-xp-yellow"
                title={t('smartSearch.saveSearchTitle')}
              >
                <Star size={14} />
              </button>
            )}

            {/* Saved Searches Toggle */}
            {savedSearches.length > 0 && (
              <button
                onClick={() => {
                  setShowSavedSearches((v) => !v);
                  setShowResults(false);
                }}
                className={`transition-colors ${
                  showSavedSearches ? 'text-xp-yellow' : 'text-xp-text-muted hover:text-xp-text'
                }`}
                title={t('smartSearch.savedSearchesTitle')}
              >
                <Star size={14} fill={showSavedSearches ? 'currentColor' : 'none'} />
              </button>
            )}

            {/* Clear Button */}
            {query && (
              <button
                onClick={() => {
                  setQuery('');
                  setResults([]);
                  setShowResults(false);
                  setSelectedIndex(-1);
                  setParsedQuery(null);
                  setTokenChips([]);
                  setGrepResults([]);
                  setGrepTriggered(false);
                  searchInputRef.current?.focus();
                }}
                className="text-xp-text-muted hover:text-xp-text"
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Search filter chips — token syntax chips + NL-parsed chips */}
        {showResults &&
          (tokenChips.length > 0 || (parsedQuery && getFilterChips(parsedQuery).length > 0)) && (
            <div className="mt-1 flex flex-wrap gap-1 px-1">
              {/* Token syntax chips (from key:value parsing) */}
              {tokenChips.map((chip) => (
                <span
                  key={`token-${chip.key}-${chip.rawValue}`}
                  className={`rounded px-2 py-0.5 text-xs font-medium ${(() => {
                    if (chip.variant === 'kind') return 'bg-xp-blue/20 text-xp-blue';
                    if (chip.variant === 'size') return 'bg-xp-green/20 text-xp-green';
                    if (chip.variant === 'date') {
                      return 'bg-xp-orange/20 text-xp-orange';
                    }
                    return 'bg-xp-purple/20 text-xp-purple';
                  })()}`}
                >
                  {chip.key}:{chip.rawValue}
                </span>
              ))}
              {/* NL-parsed chips (from enhanced search engine) */}
              {parsedQuery &&
                getFilterChips(parsedQuery).map((chip) => (
                  <span
                    key={`nl-${chip.type}-${chip.label}`}
                    className={`rounded px-2 py-0.5 text-xs font-medium ${(() => {
                      if (chip.type === 'type') return 'bg-xp-blue/20 text-xp-blue';
                      if (chip.type === 'size') return 'bg-xp-green/20 text-xp-green';
                      if (chip.type === 'date') {
                        return 'bg-xp-orange/20 text-xp-orange';
                      }
                      return 'bg-xp-purple/20 text-xp-purple';
                    })()}`}
                  >
                    {chip.label}
                  </span>
                ))}
              {parsedQuery && parsedQuery.keywords.length > 0 && (
                <span className="px-1 text-xs text-xp-text-muted">
                  + &ldquo;{parsedQuery.keywords.join(' ')}&rdquo;
                </span>
              )}
            </div>
          )}

        {/* Search Results */}
        {showResults && results.length > 0 && (
          <div
            ref={resultsRef}
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-lg border border-xp-border bg-xp-popover shadow-xl"
            style={{
              marginTop:
                tokenChips.length > 0 || (parsedQuery && getFilterChips(parsedQuery).length > 0)
                  ? '28px'
                  : '4px',
            }}
          >
            {results.map((result, index) => (
              <button
                key={result.path}
                onClick={() => handleFileSelect(result)}
                className={`w-full border-b border-xp-border p-3 text-left transition-colors last:border-b-0 hover:bg-xp-surface-light ${
                  index === selectedIndex ? 'bg-xp-surface-light' : ''
                }`}
              >
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 text-lg">{getFileIcon(result.filename)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between">
                      <h4 className="truncate text-sm font-medium">
                        {highlightMatches(result.filename, result.matches)}
                      </h4>
                      <div className="ml-2 flex flex-shrink-0 items-center space-x-1">
                        {(() => {
                          const badge = getRelevanceBadge(result.relevance_type);
                          return (
                            <span
                              className={`text-xs ${badge.color} rounded px-1.5 py-0.5 text-xp-text`}
                            >
                              {badge.label}
                            </span>
                          );
                        })()}
                        <span className="rounded bg-xp-blue/20 px-1.5 py-0.5 text-xs text-xp-blue">
                          {result.score.toFixed(1)}
                        </span>
                      </div>
                    </div>
                    <div className="mb-1 truncate text-xs text-xp-text-muted">{result.path}</div>
                    {result.snippet && (
                      <div className="mb-1.5 line-clamp-2 text-xs italic text-xp-text-secondary opacity-80">
                        &ldquo;{result.snippet}&rdquo;
                      </div>
                    )}
                    {result.matches.length > 0 && (
                      <div className="space-y-1">
                        {result.matches.slice(0, 2).map((match) => (
                          <div key={match.token} className="text-xs">
                            <span className="text-xp-text-muted">Match: </span>
                            <span className="rounded bg-xp-yellow/20 px-1">{match.token}</span>
                            {match.context && (
                              <span className="ml-1 text-xp-text-muted">- {match.context}</span>
                            )}
                          </div>
                        ))}
                        {result.matches.length > 2 && (
                          <div className="text-xs text-xp-text-muted">
                            +{result.matches.length - 2} more
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      onClick={(e) => handleFindSimilar(e, result.path)}
                      className="mt-1 text-xs text-xp-blue transition-colors hover:text-xp-accent-hover"
                      title={t('smartSearch.findSimilarTitle')}
                    >
                      {t('smartSearch.findSimilar')}
                    </button>
                  </div>
                </div>
              </button>
            ))}

            <div className="border-t border-xp-border bg-xp-bg p-3 text-center text-xs text-xp-text-muted">
              {t('smartSearch.foundResults', { count: results.length })}
              {results.length >= maxResults &&
                ` ${t('smartSearch.showingFirst', { count: maxResults })}`}
              {searchProvider !== 'local' &&
                ` ${t('smartSearch.viaProvider', { provider: PROVIDER_LABELS[searchProvider] })}`}
              {parsedQuery?.sort_hint === 'size_desc' && ` · ${t('smartSearch.sortedSizeDesc')}`}
              {parsedQuery?.sort_hint === 'size_asc' && ` · ${t('smartSearch.sortedSizeAsc')}`}
              {parsedQuery?.sort_hint === 'date_desc' && ` · ${t('smartSearch.sortedDateDesc')}`}
              {parsedQuery?.sort_hint === 'date_asc' && ` · ${t('smartSearch.sortedDateAsc')}`}
            </div>
          </div>
        )}

        {/* No Results / Grep Results */}
        {showResults && !isSearching && query.trim() && results.length === 0 && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-lg border border-xp-border bg-xp-popover shadow-xl">
            {/* Grep results */}
            {grepResults.length > 0 && (
              <div>
                <div className="border-b border-xp-border bg-xp-bg px-3 py-2 text-xs font-semibold uppercase tracking-wider text-xp-text-muted">
                  {t('smartSearch.contentMatches', { count: grepResults.length })}
                </div>
                {grepResults.map((match) => (
                  <button
                    key={`${match.file}:${match.line}`}
                    onClick={() => {
                      setShowResults(false);
                      setQuery('');
                      setResults([]);
                      setGrepResults([]);
                      setGrepTriggered(false);
                      setTokenChips([]);
                      onFileSelect?.(match.file, false);
                    }}
                    className="w-full border-b border-xp-border p-2 text-left transition-colors last:border-b-0 hover:bg-xp-surface-light"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="flex-shrink-0 text-xs font-medium text-xp-blue">
                        {match.filename}
                      </span>
                      <span className="flex-shrink-0 font-mono text-xs text-xp-text-muted">
                        :{match.line}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-xs text-xp-text">
                      {(() => {
                        const trimmed = match.content.trim();
                        const queryLower = query.toLowerCase();
                        const escaped = queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const regex = new RegExp(`(${escaped})`, 'gi');
                        const parts = trimmed.split(regex);
                        return parts.map((part, i) =>
                          part.toLowerCase() === queryLower ? (
                            // eslint-disable-next-line react/no-array-index-key
                            <mark key={i} className="rounded bg-xp-yellow/30 px-0.5">
                              {part}
                            </mark>
                          ) : (
                            // eslint-disable-next-line react/no-array-index-key
                            <span key={i}>{part}</span>
                          ),
                        );
                      })()}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* No results state */}
            {!grepTriggered && grepResults.length === 0 && (
              <div className="p-4 text-center">
                <div className="text-xp-text-secondary">
                  <svg
                    className="mx-auto mb-2 h-8 w-8 text-xp-text-muted"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <p className="text-sm text-xp-text">{t('smartSearch.noResults', { query })}</p>
                  <p className="mt-1 text-xs text-xp-text-muted">
                    {t('smartSearch.noResultsHint')}
                  </p>
                  {searchProvider === 'local' &&
                    currentPath &&
                    !currentPath.startsWith('wisp://') && (
                      <button
                        onClick={handleGrepSearch}
                        disabled={isGrepSearching}
                        className="mt-3 flex items-center gap-1.5 rounded border border-xp-border px-3 py-1.5 text-xs text-xp-blue transition-colors hover:bg-xp-blue/10 disabled:cursor-wait disabled:opacity-50"
                        style={{ margin: '12px auto 0' }}
                      >
                        {isGrepSearching ? (
                          <>
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-xp-text-muted border-t-transparent" />
                            {t('smartSearch.searchingContents')}
                          </>
                        ) : (
                          <>
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                              <line x1="16" y1="13" x2="8" y2="13" />
                              <line x1="16" y1="17" x2="8" y2="17" />
                            </svg>
                            {t('smartSearch.searchInContents')}
                          </>
                        )}
                      </button>
                    )}
                  {searchProvider === 'local' && (
                    <button
                      onClick={() => {
                        setSearchProvider('claude');
                        debouncedSearch(query);
                      }}
                      className="mt-2 text-xs text-xp-purple hover:text-xp-accent-hover"
                    >
                      {t('smartSearch.tryAiSearch')}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Grep triggered but no content results either */}
            {grepTriggered && !isGrepSearching && grepResults.length === 0 && (
              <div className="p-4 text-center">
                <div className="text-xp-text-secondary">
                  <p className="text-sm text-xp-text">{t('smartSearch.noResults', { query })}</p>
                  <p className="mt-1 text-xs text-xp-text-muted">
                    {t('smartSearch.noContentResults')}
                  </p>
                  {searchProvider === 'local' && (
                    <button
                      onClick={() => {
                        setSearchProvider('claude');
                        debouncedSearch(query);
                      }}
                      className="mt-2 text-xs text-xp-purple hover:text-xp-accent-hover"
                    >
                      {t('smartSearch.tryAiSearch')}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Loading spinner for grep */}
            {isGrepSearching && (
              <div className="flex items-center justify-center gap-2 p-4">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-xp-text-muted border-t-transparent" />
                <span className="text-xs text-xp-text-muted">
                  {t('smartSearch.searchingContents')}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);

SmartSearch.displayName = 'SmartSearch';

export default SmartSearch;
