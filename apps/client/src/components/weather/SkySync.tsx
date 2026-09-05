import { useEffect, useState } from 'react';
import { useWeather } from '@/hooks/use-weather';
import { skyGround } from '@/lib/weather';
import { isWeatherSyncEnabled } from '@/lib/weather-location';
import { STORAGE_KEYS } from '@/lib/storage-keys';

/**
 * Wisp has one stable, neutral appearance. The real sky can still stain the
 * paper ground — one quiet wash, painted on the html background and nothing
 * else. No particles, no glows, no animation; the weather chip carries the
 * literal sky.
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
  const [weatherEnabled, setWeatherEnabled] = useState(isWeatherSyncEnabled());
  // Bumped at the next sun boundary so phase flips without waiting for the
  // 30-minute weather poll.
  const [, setSunTick] = useState(0);

  // The toggle lives in settings (another route) — follow it live.
  useEffect(() => {
    const sync = () => {
      setWeatherEnabled(isWeatherSyncEnabled());
      syncAccessibilityClasses();
    };
    syncAccessibilityClasses();
    window.addEventListener('wisp-settings-changed', sync);
    return () => window.removeEventListener('wisp-settings-changed', sync);
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

  // Keep the product appearance stable. Only the ambient sky layer follows
  // the sun; the functional interface remains the same neutral light theme.
  // Dark grounds (night / rain / storm) flip the panel polarity to ink so
  // text stays readable over the deep color fields.
  useEffect(() => {
    const root = document.documentElement;
    const effective =
      weatherEnabled && report ? skyGround(report.weather_code) : ('clear' as const);
    const sky = effective !== 'clear' ? effective : phase;
    root.classList.remove('theme-rolex', 'theme-glass');
    root.classList.add(
      sky === 'night' || sky === 'rain' || sky === 'storm' ? 'theme-rolex' : 'theme-light',
    );
    root.dataset.sky = sky;
  }, [weatherEnabled, report, phase]);

  return null;
};

export default SkySync;
