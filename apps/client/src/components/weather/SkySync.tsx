import { useEffect, useState } from 'react';
import { useWeather } from '@/hooks/use-weather';
import { skyScene, type SkyScene } from '@/lib/weather';
import { isWeatherSyncEnabled } from '@/lib/weather-location';

/**
 * Route-independent sky sync: flips the document's data-sky attribute
 * (light / dark / gloom palette) from live weather. Lives at the app entry
 * so it keeps working on routes without the explorer shell (e.g. settings).
 *
 * Day/night is derived from today's sunrise/sunset in the report (local
 * time of the configured city) rather than the API's is_day flag — it flips
 * exactly at the sun boundary and stays correct around restarts.
 */
const isDaytime = (sunriseIso?: string, sunsetIso?: string, apiIsDay?: boolean): boolean => {
  if (sunriseIso && sunsetIso) {
    const now = Date.now();
    const rise = Date.parse(sunriseIso);
    const set = Date.parse(sunsetIso);
    if (Number.isFinite(rise) && Number.isFinite(set)) return now >= rise && now < set;
  }
  return apiIsDay ?? false;
};

const SkySync = () => {
  const { report } = useWeather();
  const [enabled, setEnabled] = useState(isWeatherSyncEnabled());
  // Bumped at the next sun boundary so day/night flips without waiting for
  // the 30-minute weather poll.
  const [, setSunTick] = useState(0);

  // The toggle lives in settings (another route) — follow it live.
  useEffect(() => {
    const sync = () => setEnabled(isWeatherSyncEnabled());
    window.addEventListener('wisp-settings-changed', sync);
    return () => window.removeEventListener('wisp-settings-changed', sync);
  }, []);

  let scene: SkyScene | null = null;
  if (enabled && report) {
    // daily[0] is "today" in the report's local timezone
    const today = report?.daily?.[0];
    scene = skyScene(report.weather_code, isDaytime(today?.sunrise, today?.sunset, report.is_day));
  }

  useEffect(() => {
    const today = report?.daily?.[0];
    if (!today?.sunrise || !today?.sunset) return;
    const now = Date.now();
    const rise = Date.parse(today.sunrise);
    const set = Date.parse(today.sunset);
    const next = now < rise ? rise : now < set ? set : rise + 24 * 3600_000;
    const timer = setTimeout(() => setSunTick((n) => n + 1), Math.max(0, next - now + 1000));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.daily?.[0]?.sunrise, report?.daily?.[0]?.sunset, report?.updated_at]);

  useEffect(() => {
    const root = document.documentElement;
    if (!scene) {
      delete root.dataset.sky;
      return;
    }
    root.dataset.sky =
      scene === 'clear-day' || scene === 'partly-day' || scene === 'snow'
        ? 'day'
        : scene === 'cloudy' || scene === 'fog'
          ? 'gloom'
          : 'dark';
  }, [scene]);

  return null;
};

export default SkySync;
