import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, HardDrive, MemoryStick } from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';
import type { SystemStats, TopProcess } from '@/lib/tauri-api/system';
import { isBrowserDemoMode } from '@/lib/browser-demo-files';
import { formatFileSize } from '@/lib/utils';

const SUMMARY_INTERVAL_MS = 60_000;
const DETAILS_INTERVAL_MS = 5000;

// Keep the last real sample across home visits and share in-flight native reads
// between panes. Process sampling is only requested by an expanded panel.
let statsCache: { value: SystemStats; updatedAt: number } | null = null;
let pendingStats: Promise<SystemStats> | null = null;
let pendingProcesses: Promise<TopProcess[]> | null = null;

const readStats = (maxAge: number): Promise<SystemStats> => {
  if (statsCache && Date.now() - statsCache.updatedAt < maxAge) {
    return Promise.resolve(statsCache.value);
  }
  pendingStats ??= TauriAPI.getSystemStats()
    .then((value) => {
      statsCache = { value, updatedAt: Date.now() };
      return value;
    })
    .finally(() => {
      pendingStats = null;
    });
  return pendingStats;
};

const readProcesses = (): Promise<TopProcess[]> => {
  pendingProcesses ??= TauriAPI.getTopProcesses().finally(() => {
    pendingProcesses = null;
  });
  return pendingProcesses;
};

const SystemDashboard = () => {
  const { t } = useTranslation();
  const detailsId = useId();
  const demoMode = isBrowserDemoMode();
  const [expanded, setExpanded] = useState(false);
  const [stats, setStats] = useState<SystemStats | null>(() => statsCache?.value ?? null);
  const [topProcesses, setTopProcesses] = useState<TopProcess[] | null>(null);
  const [processesUnavailable, setProcessesUnavailable] = useState(false);

  useEffect(() => {
    if (demoMode) return;
    let disposed = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interval = expanded ? DETAILS_INTERVAL_MS : SUMMARY_INTERVAL_MS;
    const canUpdate = () => !disposed && document.visibilityState === 'visible';

    const poll = async () => {
      if (!canUpdate() || running) return;
      running = true;
      const requests: Promise<unknown>[] = [
        readStats(interval).then((value) => {
          if (canUpdate()) setStats(value);
        }),
      ];
      if (expanded) {
        requests.push(
          readProcesses().then(
            (value) => {
              if (!canUpdate()) return;
              setTopProcesses(value);
              setProcessesUnavailable(false);
            },
            () => {
              if (canUpdate()) setProcessesUnavailable(true);
            },
          ),
        );
      }
      // A failed native read leaves the last successful sample intact.
      await Promise.allSettled(requests);
      running = false;
      if (canUpdate()) timer = setTimeout(() => void poll(), interval);
    };

    const handleVisibility = () => {
      clearTimeout(timer);
      if (canUpdate()) void poll();
    };
    void poll();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [demoMode, expanded]);

  const hasMemory = !!stats && stats.mem_total > 0 && Number.isFinite(stats.mem_used);
  const hasDisk = !!stats && stats.disk_total > 0 && Number.isFinite(stats.disk_available);
  if (demoMode || !stats || (!hasMemory && !hasDisk)) return null;

  const memoryPercent = Math.round((stats.mem_used / stats.mem_total) * 100);

  return (
    <section className="wisp-system-status" aria-label={t('home.systemDashboard')}>
      <button
        type="button"
        className="wisp-system-summary flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-3 py-2 text-left text-[13px] text-xp-text-secondary transition-colors hover:bg-xp-surface-light/40"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="font-medium">{t('home.systemDashboard')}</span>
        {hasDisk && (
          <span className="flex items-center gap-1.5 tabular-nums">
            <HardDrive size={14} aria-hidden="true" />
            {t('home.diskAvailable', { size: formatFileSize(stats.disk_available) })}
          </span>
        )}
        {hasMemory && (
          <span className="flex items-center gap-1.5 tabular-nums">
            <MemoryStick size={14} aria-hidden="true" />
            {t('home.memoryUsageSummary', {
              defaultValue: '{{percent}}% memory used',
              percent: memoryPercent,
            })}
          </span>
        )}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`ml-auto flex-shrink-0 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      <div id={detailsId} className="wisp-system-details px-3 pb-3 pt-2" hidden={!expanded}>
        {expanded && (
          <>
            <dl className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-3">
              {Number.isFinite(stats.cpu_usage) && (
                <div>
                  <dt className="text-xp-text-muted">{t('home.cpu')}</dt>
                  <dd className="mt-1 font-medium tabular-nums text-xp-text">
                    {Math.round(stats.cpu_usage)}%
                  </dd>
                </div>
              )}
              {hasMemory && (
                <div>
                  <dt className="text-xp-text-muted">{t('home.memory')}</dt>
                  <dd className="mt-1 font-medium tabular-nums text-xp-text">
                    {t('home.memoryUsageDetails', {
                      defaultValue: '{{used}} of {{total}} used',
                      used: formatFileSize(stats.mem_used),
                      total: formatFileSize(stats.mem_total),
                    })}
                  </dd>
                </div>
              )}
              {hasDisk && (
                <div>
                  <dt className="text-xp-text-muted">{t('home.disk')}</dt>
                  <dd className="mt-1 font-medium tabular-nums text-xp-text">
                    {t('home.diskUsageDetails', {
                      defaultValue: '{{available}} of {{total}} available',
                      available: formatFileSize(stats.disk_available),
                      total: formatFileSize(stats.disk_total),
                    })}
                  </dd>
                </div>
              )}
            </dl>

            {topProcesses && topProcesses.length > 0 && (
              <table className="wisp-system-processes mt-4 w-full text-left text-xs">
                <caption className="pb-2 text-left font-medium text-xp-text-secondary">
                  {t('home.topProcesses')}
                </caption>
                <thead className="text-xp-text-muted">
                  <tr>
                    <th className="pb-1 font-normal">
                      {t('home.processName', { defaultValue: 'Process' })}
                    </th>
                    <th className="pb-1 text-right font-normal">{t('home.cpu')}</th>
                    <th className="pb-1 text-right font-normal">{t('home.memory')}</th>
                  </tr>
                </thead>
                <tbody>
                  {topProcesses.map((process) => (
                    <tr key={process.pid} className="text-xp-text-secondary">
                      <td
                        className="max-w-0 truncate py-1 pr-3"
                        title={`${process.name} (${process.pid})`}
                      >
                        {process.name}
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {process.cpu_usage.toFixed(1)}%
                      </td>
                      <td className="py-1 pl-3 text-right tabular-nums">
                        {formatFileSize(process.memory)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {processesUnavailable && (
              <p className="mt-3 text-xs text-xp-text-muted">
                {t('home.processesUnavailable', {
                  defaultValue: 'Process details are currently unavailable.',
                })}
              </p>
            )}
            {!processesUnavailable && topProcesses === null && (
              <p className="mt-3 text-xs text-xp-text-muted">
                {t('common.loading', { defaultValue: 'Loading…' })}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
};

export default SystemDashboard;
