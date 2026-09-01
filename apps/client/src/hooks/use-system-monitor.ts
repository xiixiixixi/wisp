import { useEffect, useState } from 'react';
import { TauriAPI } from '@/lib/tauri-api';
import { isBrowserDemoMode } from '@/lib/browser-demo-files';

export interface SystemSample {
  cpu_usage: number;
  mem_total: number;
  mem_used: number;
  disk_total: number;
  disk_available: number;
}

const POLL_MS = 2000;

/** Live CPU / memory / disk samples for the performance sidebar. */
export const useSystemMonitor = (active: boolean) => {
  const [sample, setSample] = useState<SystemSample | null>(null);

  useEffect(() => {
    if (!active || isBrowserDemoMode()) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const s = await TauriAPI.getSystemStats();
        if (!cancelled) setSample(s);
      } catch {
        // keep last good sample
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void poll();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active]);

  return sample;
};
