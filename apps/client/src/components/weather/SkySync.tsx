import { useEffect, useState } from 'react';
import { useWeather } from '@/hooks/use-weather';
import { skyScene, type SkyScene } from '@/lib/weather';
import { isWeatherSyncEnabled } from '@/lib/weather-location';

/**
 * The one Wisp theme: polarity (paper by day, ink by night) and the sky
 * ground both follow the real sun — dawn and dusk get their transitional
 * washes around sunrise/sunset, weather adds precipitation on its own layer.
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

const isDaytime = (phase: SunPhase) => phase === 'dawn' || phase === 'day';

const SkySync = () => {
  const { report } = useWeather();
  const [weatherEnabled, setWeatherEnabled] = useState(isWeatherSyncEnabled());
  // Bumped at the next sun boundary so phase flips without waiting for the
  // 30-minute weather poll.
  const [, setSunTick] = useState(0);

  // The toggle lives in settings (another route) — follow it live.
  useEffect(() => {
    const sync = () => setWeatherEnabled(isWeatherSyncEnabled());
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

  // Polarity + sky ground, recomputed on every phase/tick change.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-rolex', 'theme-glass', 'theme-light');
    root.classList.add(isDaytime(phase) ? 'theme-light' : 'theme-rolex');
    root.dataset.sky = phase;
  }, [phase]);

  // Weather overlays: gloom veil when the sky is overcast (weather opt-in),
  // precipitation itself is painted by WeatherFx on its own layer.
  useEffect(() => {
    const root = document.documentElement;
    if (weatherEnabled && report) {
      const scene: SkyScene | null = skyScene(report.weather_code, isDaytime(phase));
      if (scene === 'cloudy' || scene === 'fog') {
        root.dataset.sky = 'gloom';
        return;
      }
    }
    root.dataset.sky = phase;
  }, [weatherEnabled, report, phase]);

  return null;
};

export default SkySync;
