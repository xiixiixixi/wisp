import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TauriAPI, type FileEntry, type DuplicateFinderResult } from '@/lib/tauri-api';
import { getFileIcon, cn, formatFileSize } from '@/lib/utils';
import { sizeBadgeColor } from '@/lib/format-utils';
import { listenToEvent } from '@/lib/transport';
import {
  Copy,
  Trash2,
  FolderOpen,
  Search,
  Check,
  ChevronDown,
  ChevronRight,
  X,
  ClipboardCopy,
  Loader2,
} from 'lucide-react';

interface RecommendationsPanelProps {
  selectedFile: FileEntry | null;
  currentPath?: string;
  onFileClick?: (path: string) => void;
}

interface FileRecommendation {
  path: string;
  name: string;
  score: number;
  snippet: string;
}

// ── Duplicate finder types ──────────────────────────────────────────────────

interface ScanProgress {
  currentFile: string;
  processedFiles: number;
  totalFiles: number;
  currentPhase: string;
  duplicatesFound: number;
  totalWastedSpace: number;
}

const formatSize = formatFileSize;

// ── Similar Files Tab ───────────────────────────────────────────────────────

const SimilarFilesTab = ({
  selectedFile,
  onFileClick,
}: {
  selectedFile: FileEntry | null;
  onFileClick?: (path: string) => void;
}) => {
  const { t } = useTranslation();
  const [recommendations, setRecommendations] = useState<FileRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadRecommendations = async () => {
      if (!selectedFile || selectedFile.is_dir) {
        setRecommendations([]);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const results = await TauriAPI.getFileRecommendations(selectedFile.path, 10);
        setRecommendations(
          results.map((r) => ({
            path: r.path,
            name: r.path.split(/[/\\]/).pop() || r.path,
            score: r.score,
            snippet: 'snippet' in r ? String((r as unknown as Record<string, string>).snippet) : '',
          })),
        );
      } catch (err) {
        console.error('Failed to load recommendations:', err);
        setError(err instanceof Error ? err.message : String(err));
        setRecommendations([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadRecommendations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile?.path]);

  if (!selectedFile || selectedFile.is_dir) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-xp-text-muted">
        <div className="px-4 text-center">
          <Search className="mx-auto mb-2 h-10 w-10 opacity-40" />
          <p>{t('panels.recommendations.selectFileSimilar')}</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-xp-text-muted">
        <div className="text-center">
          <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin text-xp-blue" />
          <p className="text-sm">{t('panels.recommendations.findingSimilar')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-xp-red">
        <div className="text-center">
          <X className="mx-auto mb-2 h-8 w-8" />
          <p>{t('panels.recommendations.failedLoad')}</p>
          <p className="mt-1 text-xs text-xp-text-muted">{error}</p>
        </div>
      </div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-xp-text-muted">
        <div className="px-4 text-center">
          <Search className="mx-auto mb-2 h-10 w-10 opacity-40" />
          <p>{t('panels.recommendations.noSimilar')}</p>
          <p className="mt-1 text-xs">{t('panels.recommendations.tryIndexing')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-xp-border bg-xp-surface/30 px-4 py-2">
        <p className="text-xs text-xp-text-muted">
          {t('panels.recommendations.similarTo')}{' '}
          <span className="text-xp-blue">{selectedFile.name}</span>
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {recommendations.map((rec, index) => (
          <div
            key={rec.path}
            onClick={() => onFileClick?.(rec.path)}
            className="border-xp-border/30 cursor-pointer border-b px-4 py-2.5 transition-colors hover:bg-xp-surface"
          >
            <div className="flex items-start gap-2">
              <div className="mt-0.5 flex-shrink-0">
                {getFileIcon({ path: rec.path, name: rec.name, is_dir: false } as FileEntry)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-2">
                  <span className="truncate text-xs text-xp-text">{rec.name}</span>
                  <span className="flex-shrink-0 rounded-[2px] border border-xp-blue/30 bg-xp-blue/20 px-1.5 py-0.5 text-[10px] text-xp-blue">
                    {Math.round(rec.score * 100)}%
                  </span>
                </div>
                <p className="truncate text-[10px] text-xp-text-muted" title={rec.path}>
                  {rec.path}
                </p>
                {rec.snippet && (
                  <p className="mt-1 line-clamp-2 rounded-[2px] bg-xp-surface px-2 py-1 text-[10px] text-xp-text-muted">
                    {rec.snippet}
                  </p>
                )}
              </div>
              <div className="flex-shrink-0 text-[10px] text-xp-text-muted">#{index + 1}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-xp-border bg-xp-surface/30 px-4 py-1.5">
        <p className="text-[10px] text-xp-text-muted">
          {t('panels.recommendations.similarFileCount', { count: recommendations.length })}
        </p>
      </div>
    </div>
  );
};

// ── Duplicates Tab ──────────────────────────────────────────────────────────

const DuplicatesTab = ({ currentPath }: { currentPath: string }) => {
  const { t } = useTranslation();
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [results, setResults] = useState<DuplicateFinderResult | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [scanPath, setScanPath] = useState(currentPath || '');
  const [minFileSize, setMinFileSize] = useState(1024);

  useEffect(() => {
    if (currentPath) setScanPath(currentPath);
  }, [currentPath]);

  const handleStartScan = useCallback(async () => {
    if (!scanPath.trim()) return;

    setIsScanning(true);
    setProgress(null);
    setResults(null);
    setSelectedFiles(new Set());
    setExpandedGroups(new Set());

    let unlisten: (() => void) | null = null;

    try {
      unlisten = await listenToEvent<ScanProgress>('duplicate-finder-progress', (payload) => {
        setProgress(payload);
      });

      const result = await TauriAPI.findDuplicates(scanPath, minFileSize);
      setResults(result);
    } catch (error) {
      const msg = `${error}`;
      if (!msg.includes('cancelled')) {
        console.error('Duplicate scan error:', error);
      }
    } finally {
      if (unlisten) unlisten();
      setIsScanning(false);
      setProgress(null);
    }
  }, [scanPath, minFileSize]);

  const handleCancelScan = useCallback(async () => {
    try {
      await TauriAPI.cancelDuplicateScan();
    } catch (err) {
      console.warn('Failed to cancel duplicate scan:', err);
    }
  }, []);

  const toggleFile = useCallback((path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectAllDuplicatesInGroup = useCallback(
    (group: DuplicateFinderResult['duplicate_groups'][0]) => {
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        const paths = group.files.map((f) => f.path);
        const allSelected = paths.slice(1).every((p) => prev.has(p));
        if (allSelected) {
          paths.forEach((p) => next.delete(p));
        } else {
          paths.slice(1).forEach((p) => next.add(p));
        }
        return next;
      });
    },
    [],
  );

  const toggleGroupExpansion = useCallback((hash: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  }, []);

  const handleMoveToTrash = useCallback(async () => {
    if (selectedFiles.size === 0) return;
    const confirmed = window.confirm(
      t('panels.recommendations.confirmMoveToTrash', { count: selectedFiles.size }),
    );
    if (!confirmed) return;

    try {
      await TauriAPI.moveDuplicateFilesToTrash(Array.from(selectedFiles));

      if (results) {
        const deletedSet = new Set(selectedFiles);
        const updatedGroups = results.duplicate_groups
          .map((g) => ({
            ...g,
            files: g.files.filter((f) => !deletedSet.has(f.path)),
            total_wasted_space:
              Math.max(0, g.files.filter((f) => !deletedSet.has(f.path)).length - 1) * g.size,
          }))
          .filter((g) => g.files.length >= 2);

        const total_duplicates = updatedGroups.reduce((sum, g) => sum + g.files.length, 0);
        const total_wasted_space = updatedGroups.reduce((sum, g) => sum + g.total_wasted_space, 0);
        setResults({
          ...results,
          duplicate_groups: updatedGroups,
          total_duplicates,
          total_wasted_space,
        });
      }
      setSelectedFiles(new Set());
      window.dispatchEvent(new CustomEvent('files-changed'));
    } catch (err) {
      console.error('Failed to move duplicate files to trash:', err);
    }
  }, [selectedFiles, results, t]);

  const handleOpenFolder = useCallback(async (filePath: string) => {
    try {
      const separator = filePath.includes('\\') ? '\\' : '/';
      const parentDir = filePath.substring(0, filePath.lastIndexOf(separator));
      if (parentDir) await TauriAPI.openFile(parentDir);
    } catch (err) {
      console.warn('Failed to open folder:', err);
    }
  }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Controls */}
      <div className="space-y-1.5 border-b border-xp-border px-3 py-2">
        <input
          type="text"
          value={scanPath}
          onChange={(e) => setScanPath(e.target.value)}
          placeholder={t('panels.recommendations.pathPlaceholder')}
          className="w-full rounded-[2px] border border-xp-border bg-xp-surface px-2 py-1 text-xs transition-colors focus:border-xp-blue focus:outline-none"
          disabled={isScanning}
        />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] text-xp-text-muted">
            <span>{t('panels.recommendations.minSize')}</span>
            <input
              type="number"
              value={minFileSize}
              onChange={(e) => setMinFileSize(parseInt(e.target.value) || 0)}
              className="w-16 rounded-[2px] border border-xp-border bg-xp-surface px-1 py-0.5 text-[10px] focus:border-xp-blue focus:outline-none"
              disabled={isScanning}
            />
            <span>B</span>
          </label>
          <span className="flex-1" />
          {isScanning ? (
            <button
              onClick={handleCancelScan}
              className="flex items-center gap-1 rounded-[2px] border border-xp-red/20 bg-xp-red/10 px-2 py-1 text-[10px] font-medium text-xp-red transition-colors hover:bg-xp-red/20"
            >
              <X className="h-3 w-3" />
              {t('common.cancel')}
            </button>
          ) : (
            <button
              onClick={handleStartScan}
              className="flex items-center gap-1 rounded-[2px] bg-xp-blue px-2 py-1 text-[10px] font-medium text-xp-on-accent transition-colors hover:bg-xp-blue/80"
            >
              <Search className="h-3 w-3" />
              {t('panels.recommendations.scan')}
            </button>
          )}
        </div>
      </div>

      {/* Progress */}
      {isScanning && progress && (
        <div className="border-b border-xp-border bg-xp-surface/50 px-3 py-1.5">
          <div className="mb-1 flex items-center justify-between text-[10px] text-xp-text-muted">
            <span className="capitalize">{progress.currentPhase}</span>
            <span>
              {progress.processedFiles}
              {progress.totalFiles > 0 ? ` / ${progress.totalFiles}` : ''}{' '}
              {t('panels.recommendations.files')}
            </span>
          </div>
          <div className="h-1 w-full rounded-[2px] bg-xp-surface">
            <div
              className="h-1 rounded-[2px] bg-xp-blue transition-all duration-300"
              style={{
                width:
                  progress.totalFiles > 0
                    ? `${Math.min(100, (progress.processedFiles / progress.totalFiles) * 100)}%`
                    : '60%',
                animation:
                  progress.totalFiles === 0
                    ? 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                    : undefined,
              }}
            />
          </div>
        </div>
      )}

      {/* Summary */}
      {results && results.duplicate_groups.length > 0 && (
        <div className="border-b border-xp-border bg-xp-surface/30 px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            <span className="text-xp-text-muted">
              <span className="font-medium text-xp-text">{results.duplicate_groups.length}</span>{' '}
              {t('panels.recommendations.groups')}
            </span>
            <span className="text-xp-border">|</span>
            <span className="text-xp-text-muted">
              <span className="font-medium text-xp-text">{results.total_duplicates}</span>{' '}
              {t('panels.recommendations.files')}
            </span>
            <span className="text-xp-border">|</span>
            <span className="font-medium text-xp-red">
              {formatSize(results.total_wasted_space)} {t('panels.recommendations.wasted')}
            </span>
          </div>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {results && results.duplicate_groups.length > 0 && (
          <div>
            {results.duplicate_groups.map((group) => {
              const isExpanded = expandedGroups.has(group.hash);
              const fileCount = group.files.length;
              const allDupsSelected = group.files.slice(1).every((f) => selectedFiles.has(f.path));

              return (
                <div key={group.hash} className="border-xp-border/50 border-b">
                  <div
                    className="flex cursor-pointer items-center gap-1.5 px-3 py-1.5 transition-colors hover:bg-xp-surface/50"
                    onClick={() => toggleGroupExpansion(group.hash)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3 flex-shrink-0 text-xp-text-muted" />
                    ) : (
                      <ChevronRight className="h-3 w-3 flex-shrink-0 text-xp-text-muted" />
                    )}
                    <span
                      className={cn(
                        'rounded-[2px] border px-1 py-0.5 font-mono text-[10px]',
                        sizeBadgeColor(group.size),
                      )}
                    >
                      {formatSize(group.size)}
                    </span>
                    <span
                      className="max-w-[60px] truncate font-mono text-[10px] text-xp-text-muted"
                      title={group.hash}
                    >
                      {group.hash.slice(0, 8)}
                    </span>
                    <span className="text-[10px] text-xp-text-muted">{fileCount}x</span>
                    <span className="flex-1" />
                    <span className="text-[10px] font-medium text-xp-red">
                      -{formatSize(group.total_wasted_space)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        selectAllDuplicatesInGroup(group);
                      }}
                      className={cn(
                        'rounded-[2px] border px-1 py-0.5 text-[10px] transition-colors',
                        allDupsSelected
                          ? 'border-xp-blue/30 bg-xp-blue/20 text-xp-blue'
                          : 'border-xp-border bg-xp-surface text-xp-text-muted hover:border-xp-blue/50',
                      )}
                    >
                      {allDupsSelected ? t('panels.recommendations.undo') : t('common.select')}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="space-y-0.5 pb-1.5 pl-5 pr-3">
                      {group.files.map((file, index) => {
                        const isKeep = index === 0;
                        return (
                          <div
                            key={file.path}
                            className={cn(
                              'flex items-center gap-1.5 rounded-[2px] px-1.5 py-1 text-[11px] transition-colors',
                              selectedFiles.has(file.path)
                                ? 'border border-xp-blue/20 bg-xp-blue/10'
                                : 'hover:bg-xp-surface/50',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={selectedFiles.has(file.path)}
                              onChange={() => toggleFile(file.path)}
                              className="h-3 w-3 flex-shrink-0 accent-xp-blue"
                            />
                            {isKeep ? (
                              <Check className="h-3 w-3 flex-shrink-0 text-xp-green" />
                            ) : (
                              <Copy className="h-3 w-3 flex-shrink-0 text-xp-text-muted" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xp-text">
                                {file.name}
                                {isKeep && (
                                  <span className="ml-1 text-[10px] text-xp-green">
                                    ({t('panels.recommendations.keep')})
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-[10px] text-xp-text-muted">
                                {file.path}
                              </div>
                            </div>
                            <button
                              onClick={() => handleOpenFolder(file.path)}
                              className="flex-shrink-0 rounded-[2px] p-0.5 transition-colors hover:bg-xp-surface"
                              title={t('panels.recommendations.openFolder')}
                            >
                              <FolderOpen className="h-3 w-3 text-xp-text-muted" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {results && results.duplicate_groups.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-xp-text-muted">
            <Check className="mb-2 h-8 w-8 text-xp-green" />
            <div className="text-xs font-medium">{t('panels.recommendations.noDuplicates')}</div>
          </div>
        )}

        {!isScanning && !results && (
          <div className="flex flex-col items-center justify-center py-10 text-xp-text-muted">
            <Search className="mb-2 h-8 w-8 opacity-40" />
            <div className="text-xs">{t('panels.recommendations.setPathHint')}</div>
          </div>
        )}
      </div>

      {/* Actions */}
      {results && results.duplicate_groups.length > 0 && selectedFiles.size > 0 && (
        <div className="flex items-center gap-2 border-t border-xp-border bg-xp-surface/30 px-3 py-1.5">
          <span className="text-[10px] text-xp-text-muted">
            {t('common.selected', { count: selectedFiles.size })}
          </span>
          <button
            onClick={handleMoveToTrash}
            className="flex items-center gap-1 rounded-[2px] border border-xp-red/20 bg-xp-red/10 px-2 py-0.5 text-[10px] font-medium text-xp-red transition-colors hover:bg-xp-red/20"
          >
            <Trash2 className="h-3 w-3" />
            {t('common.delete')}
          </button>
          <span className="flex-1" />
          <button
            onClick={() => {
              if (!results) return;
              const lines = results.duplicate_groups.flatMap((g, i) => [
                `Group ${i + 1}: ${formatSize(g.size)} x${g.files.length}`,
                ...g.files.map((f, j) => `  ${j === 0 ? '[KEEP]' : '[DUP] '} ${f.path}`),
                '',
              ]);
              navigator.clipboard.writeText(lines.join('\n'));
            }}
            className="rounded-[2px] p-1 transition-colors hover:bg-xp-surface"
            title={t('panels.recommendations.copyReport')}
          >
            <ClipboardCopy className="h-3 w-3 text-xp-text-muted" />
          </button>
        </div>
      )}
    </div>
  );
};

// ── Main Panel ──────────────────────────────────────────────────────────────

type TabMode = 'similar' | 'duplicates';

const RecommendationsPanel = ({
  selectedFile,
  currentPath = '',
  onFileClick,
}: RecommendationsPanelProps) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabMode>('similar');

  return (
    <div className="flex h-full flex-col text-xp-text">
      {/* Tab switcher */}
      <div className="flex flex-shrink-0 border-b border-xp-border">
        <button
          onClick={() => setActiveTab('similar')}
          className={cn(
            'flex-1 px-3 py-2 text-xs font-medium transition-colors',
            activeTab === 'similar'
              ? 'border-b-2 border-xp-blue bg-xp-surface/50 text-xp-blue'
              : 'text-xp-text-muted hover:bg-xp-surface/30 hover:text-xp-text',
          )}
        >
          {t('panels.recommendations.tabSimilar')}
        </button>
        <button
          onClick={() => setActiveTab('duplicates')}
          className={cn(
            'flex-1 px-3 py-2 text-xs font-medium transition-colors',
            activeTab === 'duplicates'
              ? 'border-b-2 border-xp-blue bg-xp-surface/50 text-xp-blue'
              : 'text-xp-text-muted hover:bg-xp-surface/30 hover:text-xp-text',
          )}
        >
          {t('panels.recommendations.tabDuplicates')}
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'similar' ? (
        <SimilarFilesTab selectedFile={selectedFile} onFileClick={onFileClick} />
      ) : (
        <DuplicatesTab currentPath={currentPath} />
      )}
    </div>
  );
};

export default RecommendationsPanel;
