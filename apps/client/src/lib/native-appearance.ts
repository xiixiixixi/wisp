import type { AppearancePreference } from '@/lib/appearance';
import { isTauri } from '@/lib/transport';

let desired: AppearancePreference | undefined;
let applied: AppearancePreference | undefined;
let pending: Promise<void> | undefined;

const flushAppearance = async (): Promise<void> => {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const appWindow = getCurrentWindow();
    while (desired !== undefined && desired !== applied) {
      const preference = desired;
      try {
        await appWindow.setTheme(preference === 'system' ? null : preference);
        applied = preference;
        document.documentElement.dataset.nativeAppearance = preference;
      } catch (error) {
        console.warn('Could not update the native window appearance:', error);
        // A failed request must not discard a newer choice made while awaiting it.
        if (desired === preference) break;
      }
    }
  } catch (error) {
    console.warn('Could not access the native window appearance:', error);
  }
};

/** Serialize app-wide native changes; keep only the latest queued preference. */
export const syncNativeAppearance = (preference: AppearancePreference): Promise<void> => {
  if (!isTauri()) return Promise.resolve();
  desired = preference;
  if (!pending && desired !== applied) {
    pending = flushAppearance().finally(() => {
      pending = undefined;
    });
  }
  return pending ?? Promise.resolve();
};
