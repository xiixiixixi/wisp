import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatFileSize } from '@/lib/utils';
import type { CleanupSuggestion } from '@/hooks/use-performance-stats';
import {
  cardStyle,
  cardTitleStyle,
  smallBtnStyle,
  suggestionRowStyle,
  StatRow,
  opColor,
  formatRelativeTime,
} from '../performance-dashboard-helpers';

// ── Types ────────────────────────────────────────────────────────────────────

interface DirectoryStats {
  fileCount: number;
  folderCount: number;
  totalSize: number;
  cachedFolderCount: number;
}

interface RecentOp {
  id?: number | string;
  operation: string;
  success: boolean;
  paths: string[];
  timestamp: string;
  details?: string | null;
}

interface MetricCardsProps {
  directoryStats: DirectoryStats;
  recentOps: RecentOp[];
  suggestions: CleanupSuggestion[];
  memoryUsage: number | null;
  isLoading: boolean;
  onRefresh: () => void;
  onSuggestionAction: (s: CleanupSuggestion) => void;
}

// ── MetricCards Component ────────────────────────────────────────────────────

const MetricCards = ({
  directoryStats,
  recentOps,
  suggestions,
  memoryUsage,
  isLoading,
  onRefresh,
  onSuggestionAction,
}: MetricCardsProps) => {
  const { t } = useTranslation();
  const opLabel = (operation: string) =>
    t(`performanceDashboard.ops.${operation}`, { defaultValue: operation });
  return (
    <div style={{ padding: '4px 12px 10px' }}>
      {/* Header with refresh */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <button
          onClick={onRefresh}
          disabled={isLoading}
          style={{
            ...smallBtnStyle,
            opacity: isLoading ? 0.5 : 1,
          }}
          title={t('performanceDashboard.refresh')}
        >
          {isLoading ? t('performanceDashboard.refreshing') : t('performanceDashboard.refresh')}
        </button>
      </div>

      {/* System Stats Card */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>{t('performanceDashboard.systemStats')}</div>
        <StatRow
          label={t('performanceDashboard.files')}
          value={directoryStats.fileCount.toLocaleString()}
        />
        <StatRow
          label={t('performanceDashboard.folders')}
          value={directoryStats.folderCount.toLocaleString()}
        />
        <StatRow
          label={t('performanceDashboard.totalSize')}
          value={formatFileSize(directoryStats.totalSize)}
        />
        {memoryUsage !== null && (
          <StatRow label={t('performanceDashboard.jsHeap')} value={formatFileSize(memoryUsage)} />
        )}
      </div>

      {/* Recent Operations Card */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>{t('performanceDashboard.recentOps')}</div>

        {recentOps.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--xp-text-secondary)', padding: '4px 0' }}>
            {t('performanceDashboard.noRecentOps')}
          </div>
        ) : (
          <>
            {/* Mini timeline */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                marginBottom: 10,
                padding: '4px 0',
              }}
            >
              <div
                style={{
                  flex: 1,
                  height: 2,
                  background: 'var(--xp-border)',
                  borderRadius: 1,
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-evenly',
                }}
              >
                {recentOps.map((op, i) => (
                  <div
                    key={op.id || i}
                    title={`${opLabel(op.operation)} - ${op.success ? t('performanceDashboard.opSuccess') : t('performanceDashboard.opFailed')}`}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: opColor(op.operation, op.success),
                      border: '1px solid var(--xp-surface)',
                      flexShrink: 0,
                      cursor: 'default',
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Operation list */}
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {recentOps.map((op, i) => (
                <div
                  key={op.id || i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 0',
                    borderBottom: i < recentOps.length - 1 ? '1px solid var(--xp-border)' : 'none',
                    fontSize: 12,
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: opColor(op.operation, op.success),
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: 'var(--xp-text)',
                    }}
                    title={op.details || opLabel(op.operation)}
                  >
                    {opLabel(op.operation)}
                  </span>
                  {op.paths.length > 0 && (
                    <span
                      style={{
                        color: 'var(--xp-text-secondary)',
                        fontSize: 11,
                        flexShrink: 0,
                      }}
                    >
                      {t('performanceDashboard.filesUnit', { count: op.paths.length })}
                    </span>
                  )}
                  <span
                    style={{
                      color: 'var(--xp-text-secondary)',
                      fontSize: 11,
                      flexShrink: 0,
                    }}
                  >
                    {formatRelativeTime(op.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Cleanup Suggestions Card */}
      {suggestions.length > 0 && (
        <div style={cardStyle}>
          <div style={cardTitleStyle}>{t('performanceDashboard.cleanupSuggestions')}</div>
          {suggestions.map((s, i) => (
            <div
              key={s.id}
              style={{
                ...suggestionRowStyle,
                borderBottom: i < suggestions.length - 1 ? '1px solid var(--xp-border)' : 'none',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--xp-text)',
                    fontWeight: 500,
                  }}
                >
                  {s.title}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--xp-text-secondary)',
                    marginTop: 2,
                  }}
                >
                  {s.description}
                  {s.estimatedSize > 0 && (
                    <span style={{ marginLeft: 4 }}>({formatFileSize(s.estimatedSize)})</span>
                  )}
                </div>
              </div>
              <button onClick={() => onSuggestionAction(s)} style={smallBtnStyle}>
                {s.actionLabel}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MetricCards;
