import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, HardDrive, MemoryStick, RotateCw, Trash2 } from 'lucide-react';
import { formatFileSize } from '@/lib/utils';
import { useSystemMonitor } from '@/hooks/use-system-monitor';
import { TauriAPI } from '@/lib/tauri-api';
import type { CleanupSuggestion } from '@/hooks/use-performance-stats';
import { smallBtnStyle, opColor, formatRelativeTime } from '../performance-dashboard-helpers';

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
  isLoading: boolean;
  onRefresh: () => void;
  onSuggestionAction?: (s: CleanupSuggestion) => void;
}

/** One live gauge: dot-matrix value + thin track with a lime slider dot. */
const GaugeCard = ({
  label,
  percent,
  caption,
  icon,
  trackColor,
  textColor,
}: {
  label: string;
  percent: number | null;
  caption: string;
  icon: React.ReactNode;
  trackColor: string;
  textColor: string;
}) => {
  const pct = percent ?? 0;
  return (
    <div className="glass-card flex flex-col rounded-xl p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-xp-text-muted">{label}</span>
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-card text-xp-text-secondary">
          {icon}
        </span>
      </div>
      <p className="font-dot mt-1.5 text-2xl leading-none text-xp-text">
        {percent === null ? '—' : Math.round(pct)}
        {percent !== null && <span className="ml-0.5 align-top text-xs">%</span>}
      </p>
      <p className="mt-1 truncate text-[10px] text-xp-text-muted" title={caption}>
        {caption}
      </p>
      <div className="bg-xp-border/60 relative mt-2 h-1 rounded-full">
        <div
          className="h-1 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: trackColor }}
        />
        {percent !== null && (
          <span
            className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-[var(--xp-lime)] shadow-[0_0_0_2px_rgba(255,255,255,0.9)]"
            style={{ left: `calc(${Math.min(Math.max(pct, 2), 98)}% - 4px)` }}
          />
        )}
      </div>
      {textColor && <span className="hidden">{textColor}</span>}
    </div>
  );
};

const MetricCards = ({ recentOps, suggestions, isLoading, onRefresh }: MetricCardsProps) => {
  const { t } = useTranslation();
  const sample = useSystemMonitor(true);
  const [emptying, setEmptying] = useState(false);
  const opLabel = (operation: string) =>
    t(`performanceDashboard.ops.${operation}`, { defaultValue: operation });

  const trashSuggestion = suggestions.find((s) => s.id === 'trash');
  const memPct = sample && sample.mem_total > 0 ? (sample.mem_used / sample.mem_total) * 100 : null;
  const diskPct =
    sample && sample.disk_total > 0
      ? ((sample.disk_total - sample.disk_available) / sample.disk_total) * 100
      : null;
  const loadColor = (pct: number | null) => {
    if (pct === null) return 'var(--xp-border)';
    if (pct < 60) return 'var(--xp-green)';
    if (pct < 85) return 'var(--xp-yellow)';
    return 'var(--xp-red)';
  };

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
      {/* Live system monitors */}
      <div className="grid grid-cols-3 gap-2">
        <GaugeCard
          label={t('performanceDashboard.cpu')}
          percent={sample ? sample.cpu_usage : null}
          caption={
            sample
              ? t('home.cpuCores', { count: navigator.hardwareConcurrency || 0 })
              : t('performanceDashboard.statsUnavailable')
          }
          icon={<Cpu size={12} aria-hidden="true" />}
          trackColor={loadColor(sample ? sample.cpu_usage : null)}
          textColor=""
        />
        <GaugeCard
          label={t('performanceDashboard.memory')}
          percent={memPct}
          caption={
            sample
              ? `${formatFileSize(sample.mem_used)} / ${formatFileSize(sample.mem_total)}`
              : t('performanceDashboard.statsUnavailable')
          }
          icon={<MemoryStick size={12} aria-hidden="true" />}
          trackColor={loadColor(memPct)}
          textColor=""
        />
        <GaugeCard
          label={t('performanceDashboard.disk')}
          percent={diskPct}
          caption={
            sample
              ? t('home.diskAvailable', { size: formatFileSize(sample.disk_available) })
              : t('performanceDashboard.statsUnavailable')
          }
          icon={<HardDrive size={12} aria-hidden="true" />}
          trackColor={loadColor(diskPct)}
          textColor=""
        />
      </div>

      {/* Quick actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {trashSuggestion && (
            <button
              onClick={handleEmptyTrash}
              disabled={emptying}
              className="flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-[11px] font-medium text-xp-text shadow-[0_1px_5px_rgba(29,28,26,0.08)] transition-transform hover:-translate-y-px disabled:opacity-50"
            >
              <Trash2 size={11} aria-hidden="true" />
              {emptying ? t('performanceDashboard.refreshing') : trashSuggestion.actionLabel}
              {trashSuggestion.estimatedSize > 0 && (
                <span className="font-dot text-[10px] text-xp-text-secondary">
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
            <span className="font-dot text-[10px] text-xp-text-muted">{recentOps.length}</span>
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
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
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
    </div>
  );
};

export default MetricCards;
