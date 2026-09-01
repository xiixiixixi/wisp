import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TauriAPI, type DuplicateFinderResult } from '@/lib/tauri-api';
import { listenToEvent } from '@/lib/transport';
import { useToast } from '@/hooks/use-toast';
import { cn, formatFileSize } from '@/lib/utils';
import { sizeBadgeColor } from '@/lib/format-utils';
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
} from 'lucide-react';

interface ScanProgress {
  currentFile: string;
  processedFiles: number;
  totalFiles: number;
  currentPhase: string;
  duplicatesFound: number;
  totalWastedSpace: number;
}

interface DuplicateFinderPanelProps {
  currentPath?: string;
}

const DuplicateFinderPanel = ({ currentPath = '' }: DuplicateFinderPanelProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();

  // State
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [results, setResults] = useState<DuplicateFinderResult | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Settings
  const [scanPath, setScanPath] = useState(currentPath || '');
  const [minFileSize, setMinFileSize] = useState(1024); // 1 KB default

  // Keep scan path in sync with currentPath prop
  useEffect(() => {
    if (currentPath) setScanPath(currentPath);
  }, [currentPath]);

  // ── Scan ────────────────────────────────────────────────────────────────────
  const handleStartScan = useCallback(async () => {
    if (!scanPath.trim()) {
      toast({
        title: t('panels.duplicateFinder.toastErrorTitle'),
        description: t('panels.duplicateFinder.toastErrorDesc'),
        variant: 'destructive',
      });
      return;
    }

    setIsScanning(true);
    setProgress(null);
    setResults(null);
    setSelectedFiles(new Set());
    setExpandedGroups(new Set());

    let unlisten: (() => void) | null = null;

    try {
      // Listen for progress events emitted by the Rust backend
      unlisten = await listenToEvent<ScanProgress>('duplicate-finder-progress', (payload) => {
        setProgress(payload);
      });

      const result = await TauriAPI.findDuplicates(scanPath, minFileSize);
      setResults(result);

      toast({
        title: t('panels.duplicateFinder.toastScanCompleteTitle'),
        description: t('panels.duplicateFinder.toastScanCompleteDesc', {
          groups: result.duplicate_groups.length,
          files: result.total_duplicates,
          size: formatFileSize(result.total_wasted_space),
        }),
      });
    } catch (error) {
      const msg = `${error}`;
      if (msg.includes('cancelled')) {
        toast({
          title: t('panels.duplicateFinder.toastCancelledTitle'),
          description: t('panels.duplicateFinder.toastCancelledDesc'),
        });
      } else {
        console.error('Duplicate scan error:', error);
        toast({
          title: t('panels.duplicateFinder.toastScanFailedTitle'),
          description: msg,
          variant: 'destructive',
        });
      }
    } finally {
      if (unlisten) unlisten();
      setIsScanning(false);
      setProgress(null);
    }
  }, [scanPath, minFileSize, toast, t]);

  const handleCancelScan = useCallback(async () => {
    try {
      await TauriAPI.cancelDuplicateScan();
    } catch (error) {
      console.error('Failed to cancel scan:', error);
      toast({
        variant: 'destructive',
        title: t('panels.duplicateFinder.toastCancelFailedTitle'),
        description: t('panels.duplicateFinder.toastCancelFailedDesc', { error: `${error}` }),
      });
    }
  }, [toast, t]);

  // ── Selection helpers ───────────────────────────────────────────────────────
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
        // Select all except the first (the "keep" file)
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

  // ── Actions ─────────────────────────────────────────────────────────────────
  const handleMoveToTrash = useCallback(async () => {
    if (selectedFiles.size === 0) {
      toast({
        title: t('panels.duplicateFinder.toastNoFilesTitle'),
        description: t('panels.duplicateFinder.toastNoFilesDesc'),
        variant: 'destructive',
      });
      return;
    }

    const confirmed = window.confirm(
      t('panels.duplicateFinder.confirmMoveToTrash', { count: selectedFiles.size }),
    );
    if (!confirmed) return;

    try {
      await TauriAPI.moveDuplicateFilesToTrash(Array.from(selectedFiles));
      toast({
        title: t('panels.duplicateFinder.toastMovedTitle'),
        description: t('panels.duplicateFinder.toastMovedDesc', { count: selectedFiles.size }),
      });

      // Remove deleted files from results
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
    } catch (error) {
      toast({
        title: t('panels.duplicateFinder.toastMoveFailedTitle'),
        description: `${error}`,
        variant: 'destructive',
      });
    }
  }, [selectedFiles, results, toast, t]);

  const handleExportReport = useCallback(() => {
    if (!results || results.duplicate_groups.length === 0) return;

    const lines: string[] = [
      '=== Duplicate File Report ===',
      `Scan path: ${scanPath}`,
      `Scanned: ${results.files_scanned} files in ${results.scan_time_ms}ms`,
      `Duplicate groups: ${results.duplicate_groups.length}`,
      `Total duplicates: ${results.total_duplicates}`,
      `Wasted space: ${formatFileSize(results.total_wasted_space)}`,
      '',
    ];

    results.duplicate_groups.forEach((group, i) => {
      lines.push(`--- Group ${i + 1} ---`);
      lines.push(`  Hash: ${group.hash}`);
      lines.push(
        `  Size: ${formatFileSize(group.size)} each | ${group.files.length} files | ${formatFileSize(group.total_wasted_space)} wasted`,
      );
      group.files.forEach((f, idx) => {
        lines.push(`  ${idx === 0 ? '[KEEP]' : '[DUP] '} ${f.path}`);
      });
      lines.push('');
    });

    navigator.clipboard.writeText(lines.join('\n')).then(
      () =>
        toast({
          title: t('panels.duplicateFinder.toastCopiedTitle'),
          description: t('panels.duplicateFinder.toastCopiedDesc'),
        }),
      () =>
        toast({
          title: t('panels.duplicateFinder.toastClipboardFailedTitle'),
          description: t('panels.duplicateFinder.toastClipboardFailedDesc'),
          variant: 'destructive',
        }),
    );
  }, [results, scanPath, toast, t]);

  const handleOpenFolder = useCallback(
    async (filePath: string) => {
      try {
        const separator = filePath.includes('\\') ? '\\' : '/';
        const parentDir = filePath.substring(0, filePath.lastIndexOf(separator));
        if (parentDir) {
          await TauriAPI.openFile(parentDir);
        }
      } catch (error) {
        console.error('Failed to open folder:', error);
        toast({
          variant: 'destructive',
          title: t('panels.duplicateFinder.toastOpenFolderFailedTitle'),
          description: t('panels.duplicateFinder.toastOpenFolderFailedDesc', { error: `${error}` }),
        });
      }
    },
    [toast, t],
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col text-xp-text">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-xp-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Copy className="h-4 w-4 text-xp-blue" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-xp-text">
            {t('panels.duplicateFinder.title')}
          </h3>
        </div>
        {scanPath && (
          <span className="max-w-[140px] truncate text-[10px] text-xp-text-muted" title={scanPath}>
            {scanPath}
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="space-y-2 border-b border-xp-border px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={scanPath}
            onChange={(e) => setScanPath(e.target.value)}
            placeholder={t('panels.duplicateFinder.pathPlaceholder')}
            className="flex-1 rounded border border-xp-border bg-xp-surface px-2 py-1.5 text-xs transition-colors focus:border-xp-blue focus:outline-none"
            disabled={isScanning}
            aria-label={t('panels.duplicateFinder.pathAriaLabel')}
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-xp-text-muted">
            <span>{t('panels.duplicateFinder.minLabel')}</span>
            <input
              type="number"
              value={minFileSize}
              onChange={(e) => setMinFileSize(parseInt(e.target.value) || 0)}
              className="w-20 rounded border border-xp-border bg-xp-surface px-1.5 py-1 text-xs focus:border-xp-blue focus:outline-none"
              disabled={isScanning}
              aria-label={t('panels.duplicateFinder.minAriaLabel')}
            />
            <span>{t('panels.duplicateFinder.bytesUnit')}</span>
          </label>

          {isScanning ? (
            <button
              onClick={handleCancelScan}
              className="flex items-center gap-1.5 rounded border border-xp-red/20 bg-xp-red/10 px-3 py-1.5 text-xs font-medium text-xp-red transition-colors hover:bg-xp-red/20"
              aria-label={t('panels.duplicateFinder.cancelAriaLabel')}
            >
              <X className="h-3 w-3" />
              {t('panels.duplicateFinder.cancel')}
            </button>
          ) : (
            <button
              onClick={handleStartScan}
              className="flex items-center gap-1.5 rounded bg-xp-blue px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-xp-blue/80"
              aria-label={t('panels.duplicateFinder.scanAriaLabel')}
            >
              <Search className="h-3 w-3" />
              {t('panels.duplicateFinder.scan')}
            </button>
          )}
        </div>
      </div>

      {/* Progress */}
      {isScanning && progress && (
        <div className="border-b border-xp-border bg-xp-surface/50 px-4 py-2">
          <div className="mb-1 flex items-center justify-between text-[10px] text-xp-text-muted">
            <span className="capitalize">{progress.currentPhase}</span>
            <span>
              {progress.processedFiles}
              {progress.totalFiles > 0 ? ` / ${progress.totalFiles}` : ''}{' '}
              {t('panels.duplicateFinder.files')}
            </span>
          </div>
          <div className="h-1.5 w-full rounded bg-xp-surface">
            <div
              className="h-1.5 rounded bg-xp-blue transition-all duration-300"
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
          {progress.currentFile && (
            <div
              className="mt-1 truncate text-[10px] text-xp-text-muted"
              title={progress.currentFile}
            >
              {progress.currentFile}
            </div>
          )}
        </div>
      )}

      {/* Summary Row */}
      {results && results.duplicate_groups.length > 0 && (
        <div className="border-b border-xp-border bg-xp-surface/30 px-4 py-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-xp-text-muted">
              {t('panels.duplicateFinder.foundLabel')}{' '}
              <span className="font-medium text-xp-text">{results.duplicate_groups.length}</span>{' '}
              {t('panels.duplicateFinder.duplicateGroupsLabel')}
            </span>
            <span className="text-xp-border">|</span>
            <span className="text-xp-text-muted">
              <span className="font-medium text-xp-text">{results.total_duplicates}</span>{' '}
              {t('panels.duplicateFinder.duplicateFilesLabel')}
            </span>
            <span className="text-xp-border">|</span>
            <span className="font-medium text-xp-red">
              {t('panels.duplicateFinder.wasted', {
                size: formatFileSize(results.total_wasted_space),
              })}
            </span>
          </div>
          <div className="mt-0.5 text-[10px] text-xp-text-muted">
            {t('panels.duplicateFinder.scannedSummary', {
              files: results.files_scanned,
              ms: results.scan_time_ms,
            })}
          </div>
        </div>
      )}

      {/* Results List */}
      <div className="flex-1 overflow-y-auto">
        {results && results.duplicate_groups.length > 0 && (
          <div>
            {results.duplicate_groups.map((group) => {
              const isExpanded = expandedGroups.has(group.hash);
              const fileCount = group.files.length;
              const allDupsSelected = group.files.slice(1).every((f) => selectedFiles.has(f.path));

              return (
                <div key={group.hash} className="border-xp-border/50 border-b">
                  {/* Group header */}
                  <div
                    className="flex cursor-pointer items-center gap-2 px-4 py-2 transition-colors hover:bg-xp-surface/50"
                    onClick={() => toggleGroupExpansion(group.hash)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-xp-text-muted" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-xp-text-muted" />
                    )}

                    {/* Size badge */}
                    <span
                      className={cn(
                        'rounded border px-1.5 py-0.5 font-mono text-[10px]',
                        sizeBadgeColor(group.size),
                      )}
                    >
                      {formatFileSize(group.size)}
                    </span>

                    {/* Hash (truncated) */}
                    <span
                      className="max-w-[80px] truncate font-mono text-[10px] text-xp-text-muted"
                      title={group.hash}
                    >
                      {group.hash.slice(0, 8)}...
                    </span>

                    {/* File count */}
                    <span className="text-xs text-xp-text-muted">
                      {fileCount} {t('panels.duplicateFinder.files')}
                    </span>

                    <span className="flex-1" />

                    {/* Wasted space */}
                    <span className="text-[10px] font-medium text-xp-red">
                      -{formatFileSize(group.total_wasted_space)}
                    </span>

                    {/* Select all duplicates toggle */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        selectAllDuplicatesInGroup(group);
                      }}
                      className={cn(
                        'rounded border px-1.5 py-0.5 text-[10px] transition-colors',
                        allDupsSelected
                          ? 'border-xp-blue/30 bg-xp-blue/20 text-xp-blue'
                          : 'border-xp-border bg-xp-surface text-xp-text-muted hover:border-xp-blue/50',
                      )}
                      title={
                        allDupsSelected
                          ? t('panels.duplicateFinder.deselectAllTitle')
                          : t('panels.duplicateFinder.selectAllTitle')
                      }
                      aria-label={
                        allDupsSelected
                          ? t('panels.duplicateFinder.deselectAllAriaLabel')
                          : t('panels.duplicateFinder.selectAllAriaLabel')
                      }
                    >
                      {allDupsSelected ? t('panels.duplicateFinder.deselect') : t('common.select')}
                    </button>
                  </div>

                  {/* Expanded file list */}
                  {isExpanded && (
                    <div className="space-y-0.5 pb-2 pl-6 pr-4">
                      {group.files.map((file, index) => {
                        const isKeep = index === 0;

                        return (
                          <div
                            key={file.path}
                            className={cn(
                              'flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors',
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
                              aria-label={t('panels.duplicateFinder.selectFileAriaLabel', {
                                name: file.name,
                              })}
                            />

                            {isKeep ? (
                              <Check className="h-3.5 w-3.5 flex-shrink-0 text-xp-green" />
                            ) : (
                              <Copy className="h-3.5 w-3.5 flex-shrink-0 text-xp-text-muted" />
                            )}

                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xp-text">
                                {file.name}
                                {isKeep && (
                                  <span className="ml-1 text-[10px] text-xp-green">
                                    {t('panels.duplicateFinder.keepBadge')}
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-[10px] text-xp-text-muted">
                                {file.path}
                              </div>
                            </div>

                            <button
                              onClick={() => handleOpenFolder(file.path)}
                              className="flex-shrink-0 rounded p-1 transition-colors hover:bg-xp-surface-light"
                              title={t('panels.duplicateFinder.openFolderTitle')}
                              aria-label={t('panels.duplicateFinder.openFolderAriaLabel', {
                                name: file.name,
                              })}
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

        {/* Empty results state */}
        {results && results.duplicate_groups.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-xp-text-secondary">
            <Check className="mb-3 h-10 w-10 text-xp-green" />
            <div className="text-sm font-medium">
              {t('panels.duplicateFinder.noDuplicatesTitle')}
            </div>
            <div className="mt-1 text-xs">{t('panels.duplicateFinder.noDuplicatesHint')}</div>
          </div>
        )}

        {/* Initial empty state */}
        {!isScanning && !results && (
          <div className="flex flex-col items-center justify-center py-12 text-xp-text-secondary">
            <Search className="mb-3 h-10 w-10 opacity-40" />
            <div className="text-sm">{t('panels.duplicateFinder.emptyStateHint')}</div>
            <div className="mt-1 text-xs">{t('panels.duplicateFinder.emptyStateHint2')}</div>
          </div>
        )}
      </div>

      {/* Actions Bar (bottom) */}
      {results && results.duplicate_groups.length > 0 && (
        <div className="flex items-center gap-2 border-t border-xp-border bg-xp-surface/30 px-4 py-2">
          {selectedFiles.size > 0 && (
            <>
              <span className="mr-1 text-[10px] text-xp-text-muted">
                {t('panels.duplicateFinder.selectedCount', { count: selectedFiles.size })}
              </span>
              <button
                onClick={handleMoveToTrash}
                className="flex items-center gap-1 rounded border border-xp-red/20 bg-xp-red/10 px-2 py-1 text-[11px] font-medium text-xp-red transition-colors hover:bg-xp-red/20"
                aria-label={t('panels.duplicateFinder.deleteSelectedAriaLabel', {
                  count: selectedFiles.size,
                })}
              >
                <Trash2 className="h-3 w-3" />
                {t('panels.duplicateFinder.deleteSelected')}
              </button>
            </>
          )}
          <span className="flex-1" />
          <button
            onClick={handleExportReport}
            className="flex items-center gap-1 rounded border border-xp-border bg-xp-surface px-2 py-1 text-[11px] font-medium text-xp-text-muted transition-colors hover:border-xp-blue/50 hover:text-xp-text"
            aria-label={t('panels.duplicateFinder.exportReportAriaLabel')}
          >
            <ClipboardCopy className="h-3 w-3" />
            {t('panels.duplicateFinder.exportReport')}
          </button>
        </div>
      )}
    </div>
  );
};

export default DuplicateFinderPanel;
