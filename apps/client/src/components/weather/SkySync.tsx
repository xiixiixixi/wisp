import { useEffect, useState } from 'react';
import { useWeather } from '@/hooks/use-weather';
import { STORAGE_KEYS } from '@/lib/storage-keys';

/**
 * 天气只以芯片与主页卡片呈现。SkySync 现在只管两件事：跟随日照的
 * 明/暗极性（白天亮纸、夜间墨纸）与流体玻璃/无障碍类开关。
 */
type SunPhase = 'dawn' | 'day' | 'dusk' | 'night';

const PHASE_WINDOW_MS = 40 * 60 * 1000;

const sunPhase = (now: number, sunrise?: string, sunset?: string): SunPhase => {
  const rise = sunrise ? Date.parse(sunrise) : NaN;
  const set = sunset ? Date.parse(sunset) : NaN;
  if (Number.isFinite(rise) && Number.isFinite(set)) {
    if (now < rise) return now >= rise - PHASE_WINDOW_MS ? 'dawn' : 'night';
    if (now < set) {
      if (now < rise + PHASE_WINDOW_MS) return 'dawn';
      return now >= set - PHASE_WINDOW_MS ? 'dusk' : 'day';
    }
    return now < set + PHASE_WINDOW_MS ? 'dusk' : 'night';
  }
  const hour = new Date(now).getHours();
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 17 && hour < 19) return 'dusk';
  return hour >= 7 && hour < 17 ? 'day' : 'night';
};

const syncAccessibilityClasses = () => {
  const root = document.documentElement;
  try {
    const settings = JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) || '{}') as {
      reducedMotion?: boolean;
      reduceTransparency?: boolean;
      enhancedFocus?: boolean;
      highContrast?: boolean;
      fluidGlass?: boolean;
    };
    root.classList.toggle('reduce-motion', settings.reducedMotion === true);
    root.classList.toggle('reduce-transparency', settings.reduceTransparency === true);
    root.classList.toggle('enhanced-focus', settings.enhancedFocus === true);
    root.classList.toggle('high-contrast', settings.highContrast === true);
    root.classList.toggle('theme-fluid', settings.fluidGlass !== false);
  } catch {
    root.classList.remove(
      'reduce-motion',
      'reduce-transparency',
      'enhanced-focus',
      'high-contrast',
    );
  }
};

const SkySync = () => {
  const { report } = useWeather();
  // Bumped at the next sun boundary so phase flips without waiting for the
  // 30-minute weather poll.
  const [, setSunTick] = useState(0);

  // The accessibility & fluid-glass classes live in settings (another route)
  // — follow them live.
  useEffect(() => {
    syncAccessibilityClasses();
    window.addEventListener('wisp-settings-changed', syncAccessibilityClasses);
    return () => window.removeEventListener('wisp-settings-changed', syncAccessibilityClasses);
  }, []);

  const today = report?.daily?.[0];
  const now = Date.now();
  const phase = sunPhase(now, today?.sunrise, today?.sunset);

  useEffect(() => {
    const sunrise = today?.sunrise;
    const sunset = today?.sunset;
    if (!sunrise || !sunset) return;
    const parsed = { rise: Date.parse(sunrise), set: Date.parse(sunset) };
    const boundaries = [
      parsed.rise - PHASE_WINDOW_MS,
      parsed.rise + PHASE_WINDOW_MS,
      parsed.set - PHASE_WINDOW_MS,
      parsed.set + PHASE_WINDOW_MS,
    ];
    const next = boundaries.find((time) => time > Date.now());
    if (next) {
      const timer = setTimeout(() => setSunTick((n) => n + 1), next - Date.now() + 1000);
      return () => clearTimeout(timer);
    }
    // After the last boundary, re-evaluate on the next poll tick.
  }, [today?.sunrise, today?.sunset, report?.updated_at]);

  // 2026-09-06 用户决定：删除全幅天气色场，天气只以芯片与主页卡片呈现。
  // SkySync 保留两件事：跟随日照的明/暗极性（白天亮纸、夜间墨纸）与
  // 流体玻璃开关；不再往 html 写 data-sky（色场 CSS 已移除）。
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-rolex', 'theme-glass');
    root.classList.add(phase === 'night' ? 'theme-rolex' : 'theme-light');
    delete root.dataset.sky;
  }, [phase]);

  return null;
};

export default SkySync;
