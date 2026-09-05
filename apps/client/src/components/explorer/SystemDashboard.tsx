import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, HardDrive, MemoryStick } from 'lucide-react';
import { TauriAPI, type TopProcess } from '@/lib/tauri-api';
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

/** Home dashboard: live CPU / memory / root-volume gauges + the heaviest
 *  processes right now (用户要求：显示最吃性能的是那几个). */
const SystemDashboard = () => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<SystemStatsState | null>(null);
  const [topProcesses, setTopProcesses] = useState<TopProcess[]>([]);

  const poll = useCallback(async () => {
    try {
      setStats(await TauriAPI.getSystemStats());
    } catch {
      // Keep the last good sample; gauges just stop moving.
    }
    try {
      setTopProcesses(await TauriAPI.getTopProcesses());
    } catch {
      // Leaderboard is additive — keep the last good list.
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

  return (
    <section aria-label={t('home.systemDashboard')} className="compact-system-dashboard">
      {/* 一行小仪表 + 进程榜（用户要求：放顶上、占地方别太大） */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        <span className="font-medium text-xp-text-secondary">{t('home.systemDashboard')}</span>
        <span className="flex items-center gap-1.5 tabular-nums text-xp-text">
          <Cpu size={12} aria-hidden="true" className="text-xp-text-muted" />
          {stats ? `${Math.round(stats.cpu_usage)}%` : '—'}
        </span>
        <span className="flex items-center gap-1.5 tabular-nums text-xp-text">
          <MemoryStick size={12} aria-hidden="true" className="text-xp-text-muted" />
          {stats ? `${Math.round((stats.mem_used / stats.mem_total) * 100)}%` : '—'}
        </span>
        <span className="flex items-center gap-1.5 tabular-nums text-xp-text">
          <HardDrive size={12} aria-hidden="true" className="text-xp-text-muted" />
          {stats ? t('home.diskAvailable', { size: formatFileSize(stats.disk_available) }) : '—'}
        </span>
        {topProcesses.slice(0, 4).map((proc) => (
          <span
            key={`${proc.pid}-${proc.name}`}
            className="hidden items-center gap-1 tabular-nums text-xp-text-muted md:inline-flex"
            title={`${t('home.topProcesses')} · ${formatFileSize(proc.memory)}`}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: gaugeColor(proc.cpu_usage) }}
            />
            <span className="max-w-[110px] truncate">{proc.name}</span>
            {proc.cpu_usage.toFixed(0)}%
          </span>
        ))}
      </div>
    </section>
  );
};

export default SystemDashboard;
