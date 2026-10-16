import { useState, useEffect, useCallback } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { isTauri } from '@/lib/transport';

interface UpdateStatus {
  available: boolean;
  version?: string;
  body?: string;
  downloading: boolean;
  progress: number;
  error?: string;
}

const useUpdater = () => {
  const [status, setStatus] = useState<UpdateStatus>({
    available: false,
    downloading: false,
    progress: 0,
  });

  // Returns the pending update, null when already on the latest version.
  // Throws on network/config errors so manual checks can surface the failure;
  // the automatic background check swallows errors via .catch().
  const checkForUpdate = useCallback(async () => {
    // The updater plugin only exists in the desktop build; the web demo must
    // stay silent instead of erroring every poll.
    if (!isTauri()) return null;
    const update = await check();
    if (update) {
      setStatus((prev) => ({
        ...prev,
        available: true,
        version: update.version,
        body: update.body ?? undefined,
        error: undefined,
      }));
    }
    return update ?? null;
  }, []);

  const installUpdate = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const update = await check();
      if (!update) return;

      setStatus((prev) => ({ ...prev, downloading: true, progress: 0 }));

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          contentLength = (event.data as { contentLength?: number }).contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloaded += (event.data as { chunkLength: number }).chunkLength;
          const progress = contentLength > 0 ? (downloaded / contentLength) * 100 : 0;
          setStatus((prev) => ({ ...prev, progress }));
        } else if (event.event === 'Finished') {
          setStatus((prev) => ({ ...prev, progress: 100 }));
        }
      });

      await relaunch();
    } catch (err) {
      console.warn('Failed to install update:', err);
      setStatus((prev) => ({
        ...prev,
        downloading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    setStatus({
      available: false,
      downloading: false,
      progress: 0,
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(
      () =>
        checkForUpdate().catch((err) => {
          // Network/endpoint failures must stay visible in the console —
          // otherwise "no update prompt" is undiagnosable.
          console.warn('[updater] automatic check failed:', err);
        }),
      5000,
    );
    const interval = setInterval(
      () =>
        checkForUpdate().catch((err) => {
          console.warn('[updater] periodic check failed:', err);
        }),
      4 * 60 * 60 * 1000,
    );
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  return { status, checkForUpdate, installUpdate, dismissUpdate };
};

export default useUpdater;
