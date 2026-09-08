import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCw, Trash2 } from 'lucide-react';
import { formatFileSize } from '@/lib/utils';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import type { CleanupSuggestion } from '@/hooks/use-performance-stats';
import { smallBtnStyle } from '../performance-dashboard-helpers';
import BatchRename from './BatchRename';

interface MetricCardsProps {
  suggestions: CleanupSuggestion[];
  allFiles: FileEntry[];
  isLoading: boolean;
  onRefresh: () => void;
}

const MetricCards = ({ suggestions, allFiles, isLoading, onRefresh }: MetricCardsProps) => {
  const { t } = useTranslation();
  const [emptying, setEmptying] = useState(false);

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
              className="flex items-center gap-1.5 rounded-[2px] border border-xp-border bg-xp-surface px-3 py-1.5 text-[11px] font-medium text-xp-text transition-colors hover:bg-xp-surface-light disabled:opacity-50"
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

      {/* Batch rename */}
      <BatchRename files={allFiles} onDone={onRefresh} />
    </div>
  );
};

export default MetricCards;
