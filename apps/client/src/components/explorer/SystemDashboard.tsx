import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, HardDrive, MemoryStick } from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';
import { isBrowserDemoMode } from '@/lib/browser-demo-files';
import { formatFileSize } from '@/lib/utils';

interface SystemStatsState {
  cpu_usage: number;
  mem_total: number;
  mem_used: number;
  disk_total: number;
  disk_available: number;
}

const POLL_INTERVAL_MS = 2000;

/** Ink colour by load: calm → warm → hot. */
const gaugeColor = (pct: number): string => {
  if (pct < 60) return 'var(--xp-green)';
  if (pct < 85) return 'var(--xp-yellow)';
  return 'var(--xp-red)';
};

const Gauge = ({
  pct,
  label,
  subtitle,
  icon,
  hero = false,
}: {
  pct: number | null;
  label: string;
  subtitle: string;
  icon: React.ReactNode;
  /** hero renders larger, with the 無印紅 position marker on the meter. */
  hero?: boolean;
}) => {
  const hasData = pct !== null;
  const value = hasData ? (pct as number) : 0;
  const color = hasData ? gaugeColor(value) : 'var(--xp-border)';

  if (hero) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-xp-border bg-xp-surface p-4 text-xp-text">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-xp-text-secondary">
            {icon}
            <span>{label}</span>
          </span>
        </div>
        <p className="mt-1.5 text-4xl font-light tabular-nums leading-none tracking-tight">
          {hasData ? Math.round(value) : '—'}
          {hasData && <span className="ml-1 align-top text-lg">%</span>}
        </p>
        <p className="mt-1.5 truncate text-xs text-xp-text-secondary" title={subtitle}>
          {subtitle}
        </p>
        <div className="relative mt-2 h-1 rounded-none bg-xp-bg">
          <div
            className="h-1 rounded-none bg-xp-text transition-all duration-500"
            style={{ width: `${value}%` }}
          />
          {hasData && (
            <span
              className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-[2px] bg-[var(--xp-lime)] shadow-[0_0_0_2px_var(--xp-surface)]"
              style={{ left: `calc(${Math.min(Math.max(value, 2), 98)}% - 5px)` }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card flex flex-col p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded bg-xp-bg text-xp-text-secondary">
          {icon}
        </span>
        <span className="text-xs font-medium text-xp-text-muted">{label}</span>
      </div>
      <p className="mt-2 text-3xl font-light tabular-nums leading-none tracking-tight text-xp-text">
        {hasData ? Math.round(value) : '—'}
        {hasData && <span className="ml-1 align-top text-base text-xp-text-secondary">%</span>}
      </p>
      <p className="mt-1 truncate text-xs text-xp-text-muted" title={subtitle}>
        {subtitle}
      </p>
      <div className="relative mt-2.5 h-1 rounded-none bg-xp-bg">
        <div
          className="h-1 rounded-none transition-all duration-500"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
        {hasData && (
          <span
            className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-[2px] bg-[var(--xp-lime)] shadow-[0_0_0_2px_var(--xp-surface)]"
            style={{ left: `calc(${Math.min(Math.max(value, 2), 98)}% - 5px)` }}
          />
        )}
      </div>
    </div>
  );
};

/** Home dashboard: live CPU / memory / root-volume gauges. */
const SystemDashboard = () => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<SystemStatsState | null>(null);

  const poll = useCallback(async () => {
    try {
      setStats(await TauriAPI.getSystemStats());
    } catch {
      // Keep the last good sample; gauges just stop moving.
    }
  }, []);

  useEffect(() => {
    if (isBrowserDemoMode()) return; // no backend in the browser demo
    void poll();
    const timer = setInterval(() => {
      // Don't burn CPU in a background window the user can't see.
      if (document.visibilityState === 'visible') void poll();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  const memPct = stats && stats.mem_total > 0 ? (stats.mem_used / stats.mem_total) * 100 : null;
  const diskPct =
    stats && stats.disk_total > 0
      ? ((stats.disk_total - stats.disk_available) / stats.disk_total) * 100
      : null;

  return (
    <section aria-label={t('home.systemDashboard')}>
      <div className="mb-3">
        <p className="text-base font-medium tracking-tight text-xp-text">
          {t('home.systemDashboard')}
        </p>
        <p className="mt-0.5 text-xs text-xp-text-muted">
          {stats ? t('home.systemDashboardLive') : t('home.statsUnavailable')}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Gauge
          pct={stats ? stats.cpu_usage : null}
          label={t('home.cpu')}
          subtitle={stats ? t('home.cpuCores', { count: navigator.hardwareConcurrency || 0 }) : '—'}
          icon={<Cpu size={14} aria-hidden="true" />}
        />
        <Gauge
          pct={memPct}
          label={t('home.memory')}
          subtitle={
            stats ? `${formatFileSize(stats.mem_used)} / ${formatFileSize(stats.mem_total)}` : '—'
          }
          icon={<MemoryStick size={14} aria-hidden="true" />}
        />
        <Gauge
          pct={diskPct}
          label={t('home.disk')}
          subtitle={
            stats ? t('home.diskAvailable', { size: formatFileSize(stats.disk_available) }) : '—'
          }
          icon={<HardDrive size={14} aria-hidden="true" />}
          hero
        />
      </div>
    </section>
  );
};

export default SystemDashboard;
