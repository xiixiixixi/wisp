import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCw, Trash2 } from 'lucide-react';
import { formatFileSize } from '@/lib/utils';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import type { CleanupSuggestion } from '@/hooks/use-performance-stats';
import { smallBtnStyle, opColor, formatRelativeTime } from '../performance-dashboard-helpers';
import BatchRename from './BatchRename';

interface RecentOp {
  id?: number | string;
  operation: string;
  success: boolean;
  paths: string[];
  timestamp: string;
  details?: string | null;
}

interface MetricCardsProps {
  recentOps: RecentOp[];
  suggestions: CleanupSuggestion[];
  allFiles: FileEntry[];
  isLoading: boolean;
  onRefresh: () => void;
}

const MetricCards = ({
  recentOps,
  suggestions,
  allFiles,
  isLoading,
  onRefresh,
}: MetricCardsProps) => {
  const { t } = useTranslation();
  const [emptying, setEmptying] = useState(false);
  const opLabel = (operation: string) =>
    t(`performanceDashboard.ops.${operation}`, { defaultValue: operation });

  const trashSuggestion = suggestions.find((s) => s.id === 'trash');

  const handleEmptyTrash = async () => {
    setEmptying(true);
    try {
      await TauriAPI.emptyTrash();
    } catch {
      // silently fail — refresh still runs
    }
    setEmptying(false);
    onRefresh();
  };

  return (
    <div className="flex flex-col gap-3 px-3 pb-4 pt-1">
      {/* Quick actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {trashSuggestion && (
            <button
              onClick={handleEmptyTrash}
              disabled={emptying}
              className="flex items-center gap-1.5 rounded border border-xp-border bg-xp-surface px-3 py-1.5 text-[11px] font-medium text-xp-text transition-colors hover:bg-xp-surface-light disabled:opacity-50"
            >
              <Trash2 size={11} aria-hidden="true" />
              {emptying ? t('performanceDashboard.refreshing') : trashSuggestion.actionLabel}
              {trashSuggestion.estimatedSize > 0 && (
                <span className="text-[10px] text-xp-text-secondary">
                  {formatFileSize(trashSuggestion.estimatedSize)}
                </span>
              )}
            </button>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          style={{ ...smallBtnStyle, opacity: isLoading ? 0.5 : 1 }}
          title={t('performanceDashboard.refresh')}
        >
          <span className="flex items-center gap-1">
            <RotateCw size={10} aria-hidden="true" />
            {isLoading ? t('performanceDashboard.refreshing') : t('performanceDashboard.refresh')}
          </span>
        </button>
      </div>

      {/* Activity timeline */}
      <div className="glass-card rounded-xl p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-xp-text-muted">
            {t('performanceDashboard.activity')}
          </span>
          {recentOps.length > 0 && (
            <span className="text-[10px] text-xp-text-muted">{recentOps.length}</span>
          )}
        </div>
        {recentOps.length === 0 ? (
          <div className="py-2 text-[11px] text-xp-text-muted">
            {t('performanceDashboard.noRecentOps')}
          </div>
        ) : (
          <div className="max-h-56 overflow-y-auto">
            {recentOps.map((op, i) => (
              <div
                key={op.id || i}
                className="flex items-center gap-2 py-[5px] text-[11px]"
                style={{
                  borderBottom: i < recentOps.length - 1 ? '1px solid var(--xp-border)' : 'none',
                }}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-[2px]"
                  style={{ background: opColor(op.operation, op.success) }}
                />
                <span className="min-w-0 flex-1 truncate text-xp-text" title={op.details || ''}>
                  {opLabel(op.operation)}
                </span>
                {op.paths.length > 0 && (
                  <span className="shrink-0 text-[10px] text-xp-text-secondary">
                    {t('performanceDashboard.filesUnit', { count: op.paths.length })}
                  </span>
                )}
                <span className="shrink-0 text-[10px] text-xp-text-muted">
                  {formatRelativeTime(op.timestamp)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Batch rename */}
      <BatchRename files={allFiles} onDone={onRefresh} />
    </div>
  );
};

export default MetricCards;
