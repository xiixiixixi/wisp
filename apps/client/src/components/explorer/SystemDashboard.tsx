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

/** 5s — slow enough that the numbers read as a status, not a spinner. */
const POLL_INTERVAL_MS = 5000;
const TOP_ROWS = 5;

/** Ink colour by load: calm → warm → hot. */
const gaugeColor = (pct: number): string => {
  if (pct < 60) return 'var(--xp-green)';
  if (pct < 85) return 'var(--xp-yellow)';
  return 'var(--xp-red)';
};

/**
 * 系统状态紧凑卡：一行指标（CPU/内存/磁盘）+ 最吃性能进程表。
 * 固定结构、5 秒节流——数值更新但版面绝不跳动。
 */
const SystemDashboard = () => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<SystemStatsState | null>(null);
  const [topProcesses, setTopProcesses] = useState<TopProcess[]>([]);

  const poll = useCallback(async () => {
    try {
      setStats(await TauriAPI.getSystemStats());
    } catch {
      // keep the last good sample
    }
    try {
      setTopProcesses(await TauriAPI.getTopProcesses());
    } catch {
      // keep the last good list
    }
  }, []);

  useEffect(() => {
    if (isBrowserDemoMode()) return; // no backend in the browser demo
    void poll();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void poll();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  // 没有后端数据（demo / 后端不可用）整卡不渲染。
  if (!stats) return null;

  const rows = topProcesses.slice(0, TOP_ROWS);

  return (
    <section
      aria-label={t('home.systemDashboard')}
      className="compact-system-dashboard rounded-lg border border-xp-border bg-xp-surface/60 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <span className="text-xs font-medium text-xp-text-secondary">
          {t('home.systemDashboard')}
        </span>
        <span className="flex items-center gap-1.5 text-xs tabular-nums text-xp-text">
          <Cpu size={12} aria-hidden="true" className="text-xp-text-muted" />
          {`${Math.round(stats.cpu_usage)}%`}
        </span>
        <span className="flex items-center gap-1.5 text-xs tabular-nums text-xp-text">
          <MemoryStick size={12} aria-hidden="true" className="text-xp-text-muted" />
          {`${Math.round((stats.mem_used / stats.mem_total) * 100)}%`}
        </span>
        <span className="flex items-center gap-1.5 text-xs tabular-nums text-xp-text">
          <HardDrive size={12} aria-hidden="true" className="text-xp-text-muted" />
          {t('home.diskAvailable', { size: formatFileSize(stats.disk_available) })}
        </span>
      </div>

      {rows.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-medium text-xp-text-muted">{t('home.topProcesses')}</p>
          <div className="mt-1 flex flex-col gap-0.5">
            {rows.map((proc) => (
              <div
                key={`${proc.pid}-${proc.name}`}
                className="flex items-center gap-3 text-xs"
                title={`${proc.name} (pid ${proc.pid})`}
              >
                <span className="w-40 min-w-0 flex-shrink-0 truncate text-xp-text">
                  {proc.name}
                </span>
                <div className="h-1 min-w-0 flex-1 rounded bg-xp-bg">
                  <div
                    className="h-1 rounded transition-all duration-700"
                    style={{
                      width: `${Math.min(proc.cpu_usage, 100)}%`,
                      backgroundColor: gaugeColor(proc.cpu_usage),
                    }}
                  />
                </div>
                <span className="w-12 flex-shrink-0 text-right tabular-nums text-xp-text-secondary">
                  {proc.cpu_usage.toFixed(1)}%
                </span>
                <span className="w-20 flex-shrink-0 text-right tabular-nums text-xp-text-muted">
                  {formatFileSize(proc.memory)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

export default SystemDashboard;
