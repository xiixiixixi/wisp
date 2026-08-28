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

const RING_RADIUS = 30;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const Gauge = ({
  pct,
  label,
  subtitle,
  icon,
}: {
  pct: number | null;
  label: string;
  subtitle: string;
  icon: React.ReactNode;
}) => {
  const hasData = pct !== null;
  const value = hasData ? (pct as number) : 0;
  const color = hasData ? gaugeColor(value) : 'var(--xp-border)';

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-xp-border bg-muted p-4 shadow-sm">
      <div className="relative flex h-[76px] w-[76px] shrink-0 items-center justify-center">
        <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle
            cx="38"
            cy="38"
            r={RING_RADIUS}
            fill="none"
            stroke="var(--xp-border)"
            strokeWidth="7"
          />
          <circle
            cx="38"
            cy="38"
            r={RING_RADIUS}
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - value / 100)}
            style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.6s ease' }}
          />
        </svg>
        <span className="absolute text-sm font-semibold tabular-nums text-xp-text">
          {hasData ? `${Math.round(value)}%` : '—'}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-medium text-xp-text-muted">
          {icon}
          <span>{label}</span>
        </div>
        <p className="mt-1 truncate text-sm font-semibold text-xp-text" title={subtitle}>
          {subtitle}
        </p>
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
      <div className="mb-2.5">
        <p className="text-sm font-semibold text-xp-text">{t('home.systemDashboard')}</p>
        <p className="mt-0.5 text-xs text-xp-text-muted">
          {stats ? t('home.systemDashboardLive') : t('home.statsUnavailable')}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Gauge
          pct={stats ? stats.cpu_usage : null}
          label={t('home.cpu')}
          subtitle={stats ? t('home.cpuCores', { count: navigator.hardwareConcurrency || 0 }) : '—'}
          icon={<Cpu size={13} aria-hidden="true" />}
        />
        <Gauge
          pct={memPct}
          label={t('home.memory')}
          subtitle={
            stats ? `${formatFileSize(stats.mem_used)} / ${formatFileSize(stats.mem_total)}` : '—'
          }
          icon={<MemoryStick size={13} aria-hidden="true" />}
        />
        <Gauge
          pct={diskPct}
          label={t('home.disk')}
          subtitle={
            stats ? t('home.diskAvailable', { size: formatFileSize(stats.disk_available) }) : '—'
          }
          icon={<HardDrive size={13} aria-hidden="true" />}
        />
      </div>
    </section>
  );
};

export default SystemDashboard;
