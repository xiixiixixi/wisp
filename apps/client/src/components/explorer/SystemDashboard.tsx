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

/** Ring colour by load: calm → warm → hot. */
const gaugeColor = (pct: number): string => {
  if (pct < 60) return 'var(--xp-green, #4ec9b0)';
  if (pct < 85) return 'var(--xp-yellow, #e2b340)';
  return 'var(--xp-red, #f44747)';
};

const Gauge = ({
  pct,
  label,
  subtitle,
  icon,
  tint,
  hero = false,
}: {
  pct: number | null;
  label: string;
  subtitle: string;
  icon: React.ReactNode;
  /** Ambient wash colours for the liquid-glass card, [top-left, bottom-right]. */
  tint: [string, string];
  /** hero renders as the vivid gradient stat card with white dot-matrix numerals */
  hero?: boolean;
}) => {
  const hasData = pct !== null;
  const value = hasData ? (pct as number) : 0;
  const color = hasData ? gaugeColor(value) : 'var(--xp-border)';

  if (hero) {
    return (
      <div
        className="relative overflow-hidden rounded-2xl p-4 text-white shadow-[0_14px_36px_rgba(232,113,29,0.28)]"
        style={{
          background: 'linear-gradient(135deg, #ffc46a 0%, #ff9d3f 34%, #f0609e 78%, #e0447f 100%)',
        }}
      >
        <div
          className="dot-grid pointer-events-none absolute inset-x-4 bottom-9 h-7 opacity-50"
          style={{
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.8) 1.2px, transparent 1.3px)',
          }}
        />
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-white/85">
            {icon}
            <span>{label}</span>
          </span>
        </div>
        <p className="font-dot mt-1.5 text-4xl leading-none">
          {hasData ? Math.round(value) : '—'}
          {hasData && <span className="ml-1 align-top text-lg">%</span>}
        </p>
        <p className="mt-1.5 truncate text-xs text-white/85" title={subtitle}>
          {subtitle}
        </p>
        <div className="relative mt-2 h-1 rounded-full bg-white/30">
          <div
            className="h-1 rounded-full bg-white transition-all duration-500"
            style={{ width: `${value}%` }}
          />
          {hasData && (
            <span
              className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-[var(--xp-lime)] shadow-[0_0_0_2px_rgba(255,255,255,0.85)]"
              style={{ left: `calc(${Math.min(Math.max(value, 2), 98)}% - 5px)` }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="glass-card glass-dotted flex flex-col rounded-2xl p-4"
      style={
        {
          '--tint-a': tint[0],
          '--tint-b': tint[1],
        } as React.CSSProperties
      }
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-card text-xp-text-secondary shadow-[0_1px_4px_rgba(29,28,26,0.08)]">
          {icon}
        </span>
        <span className="text-xs font-medium text-xp-text-muted">{label}</span>
      </div>
      <p className="font-dot mt-2 text-3xl leading-none text-xp-text">
        {hasData ? Math.round(value) : '—'}
        {hasData && <span className="ml-1 align-top text-base text-xp-text-secondary">%</span>}
      </p>
      <p className="mt-1 truncate text-xs text-xp-text-muted" title={subtitle}>
        {subtitle}
      </p>
      <div className="bg-xp-border/60 relative mt-2.5 h-1 rounded-full">
        <div
          className="h-1 rounded-full transition-all duration-500"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
        {hasData && (
          <span
            className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-[var(--xp-lime)] shadow-[0_0_0_2px_rgba(255,255,255,0.9)]"
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
        <p className="text-base font-semibold tracking-tight text-xp-text">
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
          tint={['rgba(99, 112, 255, 0.55)', 'rgba(64, 200, 220, 0.4)']}
        />
        <Gauge
          pct={memPct}
          label={t('home.memory')}
          subtitle={
            stats ? `${formatFileSize(stats.mem_used)} / ${formatFileSize(stats.mem_total)}` : '—'
          }
          icon={<MemoryStick size={14} aria-hidden="true" />}
          tint={['rgba(150, 108, 240, 0.5)', 'rgba(235, 108, 180, 0.42)']}
        />
        <Gauge
          pct={diskPct}
          label={t('home.disk')}
          subtitle={
            stats ? t('home.diskAvailable', { size: formatFileSize(stats.disk_available) }) : '—'
          }
          icon={<HardDrive size={14} aria-hidden="true" />}
          tint={['rgba(245, 150, 90, 0.48)', 'rgba(235, 90, 110, 0.4)']}
          hero
        />
      </div>
    </section>
  );
};

export default SystemDashboard;
