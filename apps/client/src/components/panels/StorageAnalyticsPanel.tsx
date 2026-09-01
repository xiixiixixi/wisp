import i18n from '@/i18n';
import React, { useState, useCallback, useEffect } from 'react';
import { listenToEvent } from '@/lib/transport';
import { TauriAPI, StorageAnalytics, StorageAnalysisProgress } from '@/lib/tauri-api';
import { BarChart3, HardDrive, FileText, FolderClosed } from 'lucide-react';
import { formatFileSize } from '@/lib/utils';

interface StorageAnalyticsPanelProps {
  currentPath: string;
  navigateToPath?: (path: string) => void;
}

const BAR_COLORS = [
  'var(--xp-blue)', // blue
  'var(--xp-green)', // green
  'var(--xp-purple)', // purple
  'var(--xp-orange)', // orange
  'var(--xp-red)', // red
  'var(--xp-cyan)', // cyan
  'var(--xp-yellow)', // yellow
  'var(--xp-green)', // teal
  'var(--xp-cyan)', // mint
  'var(--xp-text)', // lavender
];

const SIZE_CAT_COLORS = [
  'var(--xp-cyan)', // Tiny - cyan
  'var(--xp-green)', // Small - green
  'var(--xp-blue)', // Medium - blue
  'var(--xp-orange)', // Large - orange
  'var(--xp-red)', // Huge - red
];

const formatNumber = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
};

const truncatePath = (p: string, maxLen: number): string => {
  if (p.length <= maxLen) return p;
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(sep);
  if (parts.length <= 3) return `...${p.slice(-(maxLen - 3))}`;
  return `${parts[0] + sep}...${sep}${parts.slice(-2).join(sep)}`;
};

const StorageAnalyticsPanel = ({ currentPath, navigateToPath }: StorageAnalyticsPanelProps) => {
  const [analytics, setAnalytics] = useState<StorageAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<StorageAnalysisProgress | null>(null);
  const [analyzedPath, setAnalyzedPath] = useState('');

  const runAnalysis = useCallback(async () => {
    if (!currentPath) return;
    setLoading(true);
    setError(null);
    setAnalytics(null);
    setProgress(null);

    let unlisten: (() => void) | null = null;
    try {
      // Listen for progress events
      unlisten = await listenToEvent<StorageAnalysisProgress>(
        'storage-analysis-progress',
        (payload) => {
          setProgress(payload);
        },
      );

      const result = await TauriAPI.analyzeStorage(currentPath);
      setAnalytics(result);
      setAnalyzedPath(currentPath);

      // Ensure the analyzed path is whitelisted for tokenizer indexing
      TauriAPI.addPathToTokenizer(currentPath).catch(() => {
        /* fire-and-forget */
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (unlisten) unlisten();
      setLoading(false);
      setProgress(null);
    }
  }, [currentPath]);

  // Auto-analyze when the path changes
  useEffect(() => {
    if (currentPath && currentPath !== analyzedPath) {
      runAnalysis();
    }
  }, [currentPath, analyzedPath, runAnalysis]);

  const handleFileClick = (filePath: string) => {
    if (!navigateToPath) return;
    const sep = filePath.includes('\\') ? '\\' : '/';
    const parentDir = filePath.substring(0, filePath.lastIndexOf(sep));
    if (parentDir) navigateToPath(parentDir);
  };

  // --- Loading state ---
  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
        <div
          className="loading-spinner h-8 w-8 rounded-full border-2 border-current border-t-transparent"
          style={{ borderColor: 'var(--xp-blue)', borderTopColor: 'transparent' }}
        />
        <p className="text-sm text-xp-text-muted">Analyzing storage...</p>
        {progress && (
          <div className="w-full space-y-1 text-xs text-xp-text-muted">
            <p>
              {formatNumber(progress.files_processed)} files /{' '}
              {formatNumber(progress.dirs_processed)} folders scanned
            </p>
            <p>{formatFileSize(progress.bytes_processed)} processed</p>
            <p className="truncate opacity-60" title={progress.current_path}>
              {truncatePath(progress.current_path, 40)}
            </p>
          </div>
        )}
      </div>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <div className="space-y-3 p-4">
        <div
          className="rounded-[2px] border p-3"
          style={{
            borderColor: 'color-mix(in srgb, var(--xp-red) 20%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--xp-red) 7%, transparent)',
          }}
        >
          <p className="text-sm" style={{ color: 'var(--xp-red)' }}>
            Analysis failed: {error}
          </p>
        </div>
        <button
          onClick={runAnalysis}
          className="w-full rounded-[2px] bg-xp-surface-light px-3 py-2 text-sm text-xp-text transition-colors hover:bg-xp-blue"
        >
          Retry
        </button>
      </div>
    );
  }

  // --- No data yet ---
  if (!analytics) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <div className="text-3xl">
          <BarChart3 size="1em" className="inline-block" />
        </div>
        <p className="text-sm text-xp-text-muted">
          {currentPath
            ? i18n.t('storageAnalytics.clickAnalyze')
            : i18n.t('storageAnalytics.navigateToAnalyze')}
        </p>
        {currentPath && (
          <button
            onClick={runAnalysis}
            className="rounded-[2px] bg-xp-blue px-4 py-2 text-sm text-xp-on-accent transition-colors hover:opacity-90"
          >
            Analyze Storage
          </button>
        )}
      </div>
    );
  }

  // --- Analytics dashboard ---
  const {
    total_size,
    used_size,
    free_size,
    file_count,
    dir_count,
    file_type_distribution,
    largest_files,
    size_categories,
  } = analytics;
  const usedPercent = total_size > 0 ? Math.round((used_size / total_size) * 100) : 0;
  const freePercent = total_size > 0 ? 100 - usedPercent : 0;
  const hasDiskInfo = free_size > 0 || total_size > used_size;
  const top10Types = file_type_distribution.slice(0, 10);
  const maxTypeSize = top10Types.length > 0 ? top10Types[0].total_size : 1;
  const totalFilesSize = file_type_distribution.reduce((sum, t) => sum + t.total_size, 0);
  const maxCatSize = size_categories.reduce((max, c) => Math.max(max, c.total_size), 1);

  return (
    <div className="space-y-4 overflow-y-auto p-3 text-sm" style={{ maxHeight: '100%' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-xp-text">Storage Analytics</h3>
          <p className="truncate text-xs text-xp-text-muted" title={analyzedPath}>
            {analyzedPath}
          </p>
        </div>
        <button
          onClick={runAnalysis}
          className="ml-2 shrink-0 rounded-[2px] border border-xp-border bg-xp-surface-light px-2 py-1 text-xs transition-colors hover:bg-xp-blue hover:text-xp-on-accent"
          title={i18n.t('storageAnalytics.refresh')}
        >
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-2">
        {/* Total Size */}
        <div
          className="rounded-[2px] border border-xp-border p-2.5"
          style={{
            backgroundColor: 'rgba(var(--xp-surface-rgb, 36, 40, 59), 0.5)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <div className="mb-0.5 text-base">
            <HardDrive size="1em" className="inline-block" />
          </div>
          <div className="text-sm font-bold text-xp-text">
            {formatFileSize(hasDiskInfo ? total_size : used_size)}
          </div>
          <div className="text-[10px] text-xp-text-muted">
            {hasDiskInfo
              ? i18n.t('storageAnalytics.diskTotal')
              : i18n.t('storageAnalytics.totalSize')}
          </div>
        </div>
        {/* Files */}
        <div
          className="rounded-[2px] border border-xp-border p-2.5"
          style={{
            backgroundColor: 'rgba(var(--xp-surface-rgb, 36, 40, 59), 0.5)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <div className="mb-0.5 text-base">
            <FileText size="1em" className="inline-block" />
          </div>
          <div className="text-sm font-bold text-xp-text">{formatNumber(file_count)}</div>
          <div className="text-[10px] text-xp-text-muted">Files</div>
        </div>
        {/* Folders */}
        <div
          className="rounded-[2px] border border-xp-border p-2.5"
          style={{
            backgroundColor: 'rgba(var(--xp-surface-rgb, 36, 40, 59), 0.5)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <div className="mb-0.5 text-base">
            <FolderClosed size="1em" className="inline-block" />
          </div>
          <div className="text-sm font-bold text-xp-text">{formatNumber(dir_count)}</div>
          <div className="text-[10px] text-xp-text-muted">Folders</div>
        </div>
      </div>

      {/* Disk Usage Bar */}
      {hasDiskInfo && (
        <div
          className="rounded-[2px] border border-xp-border p-3"
          style={{
            backgroundColor: 'rgba(var(--xp-surface-rgb, 36, 40, 59), 0.5)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-xp-text">Disk Usage</span>
            <span className="text-xs text-xp-text-muted">
              {formatFileSize(used_size)} / {formatFileSize(total_size)}
            </span>
          </div>
          <div
            className="h-3 w-full overflow-hidden rounded-[2px] border border-xp-border bg-xp-bg"
            style={{ backgroundColor: 'rgba(var(--xp-overlay-rgb, 86, 90, 110), 0.3)' }}
          >
            <div
              className="h-full rounded-[2px] transition-all duration-500"
              style={{
                width: `${usedPercent}%`,
                background: (() => {
                  if (usedPercent > 90) {
                    return 'var(--xp-red)';
                  }
                  if (usedPercent > 70) {
                    return 'var(--xp-orange)';
                  }
                  return 'var(--xp-green)';
                })(),
              }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-xp-text-muted">
            <span>Used: {usedPercent}%</span>
            <span>
              Free: {freePercent}% ({formatFileSize(free_size)})
            </span>
          </div>
        </div>
      )}

      {/* File Type Distribution */}
      {top10Types.length > 0 && (
        <div
          className="rounded-[2px] border border-xp-border p-3"
          style={{
            backgroundColor: 'rgba(var(--xp-surface-rgb, 36, 40, 59), 0.5)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <h4 className="mb-2 text-xs font-medium text-xp-text">File Types (Top 10 by Size)</h4>
          <div className="space-y-1.5">
            {top10Types.map((t, i) => {
              const pct = totalFilesSize > 0 ? (t.total_size / totalFilesSize) * 100 : 0;
              const barWidth = maxTypeSize > 0 ? (t.total_size / maxTypeSize) * 100 : 0;
              const color = BAR_COLORS[i % BAR_COLORS.length];
              return (
                <div key={t.extension} className="group">
                  <div className="mb-0.5 flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-[1px]"
                      style={{ backgroundColor: color }}
                    />
                    <span
                      className="truncate font-mono text-[11px] text-xp-text"
                      style={{ minWidth: 50 }}
                    >
                      .{t.extension}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-xp-text-muted">
                      {formatFileSize(t.total_size)} ({pct.toFixed(1)}%)
                    </span>
                  </div>
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-[2px] bg-xp-bg"
                    style={{ backgroundColor: 'rgba(var(--xp-overlay-rgb, 86, 90, 110), 0.2)' }}
                  >
                    <div
                      className="h-full rounded-[2px] transition-all duration-300"
                      style={{ width: `${barWidth}%`, backgroundColor: color }}
                    />
                  </div>
                  <div className="mt-0.5 text-[10px] text-xp-text-muted">
                    {formatNumber(t.count)} files
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Size Distribution */}
      {size_categories.length > 0 && (
        <div
          className="rounded-[2px] border border-xp-border p-3"
          style={{
            backgroundColor: 'rgba(var(--xp-surface-rgb, 36, 40, 59), 0.5)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <h4 className="mb-2 text-xs font-medium text-xp-text">Size Distribution</h4>
          <div className="space-y-1.5">
            {size_categories.map((cat, i) => {
              const barWidth = maxCatSize > 0 ? (cat.total_size / maxCatSize) * 100 : 0;
              const color = SIZE_CAT_COLORS[i % SIZE_CAT_COLORS.length];
              return (
                <div key={cat.label}>
                  <div className="mb-0.5 flex items-center justify-between">
                    <span className="text-[11px] text-xp-text">{cat.label}</span>
                    <span className="text-[10px] text-xp-text-muted">
                      {formatNumber(cat.count)} files / {formatFileSize(cat.total_size)}
                    </span>
                  </div>
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-[2px] bg-xp-bg"
                    style={{ backgroundColor: 'rgba(var(--xp-overlay-rgb, 86, 90, 110), 0.2)' }}
                  >
                    <div
                      className="h-full rounded-[2px] transition-all duration-300"
                      style={{ width: `${barWidth}%`, backgroundColor: color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Largest Files */}
      {largest_files.length > 0 && (
        <div
          className="rounded-[2px] border border-xp-border p-3"
          style={{
            backgroundColor: 'rgba(var(--xp-surface-rgb, 36, 40, 59), 0.5)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <h4 className="mb-2 text-xs font-medium text-xp-text">
            Largest Files (Top {largest_files.length})
          </h4>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {largest_files.map((file, i) => (
              <div
                key={file.path}
                className="group flex cursor-pointer items-center gap-2 rounded-[2px] p-1.5 transition-colors hover:bg-xp-surface-light"
                onClick={() => handleFileClick(file.path)}
                title={file.path}
              >
                <span className="w-4 shrink-0 text-right text-[10px] text-xp-text-muted">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] text-xp-text">{file.name}</p>
                  <p className="truncate text-[10px] text-xp-text-muted opacity-60 group-hover:opacity-100">
                    {truncatePath(file.path, 45)}
                  </p>
                </div>
                <span
                  className="shrink-0 font-mono text-[11px]"
                  style={{ color: 'var(--xp-orange)' }}
                >
                  {formatFileSize(file.size)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default StorageAnalyticsPanel;
