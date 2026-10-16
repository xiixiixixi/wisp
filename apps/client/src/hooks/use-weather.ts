import { useEffect, useState } from 'react';
import { TauriAPI, type WeatherReport } from '@/lib/tauri-api';
import { isBrowserDemoMode } from '@/lib/browser-demo-files';
import { getWeatherLocation } from '@/lib/weather-location';

/**
 * Shared weather state: one fetch per coordinates, polled every 30 minutes,
 * shared across every consumer (home chip + the SkySync sky ground).
 * The Rust command caches server-side for 15 minutes as well.
 *
 * Reads the city from app settings directly and re-fetches whenever the
 * user changes it (`wisp-settings-changed` is dispatched by the settings
 * page on every update).
 */

const REFRESH_MS = 30 * 60 * 1000;
const ERROR_RETRY_MS = 5 * 60 * 1000;

export interface WeatherState {
  report: WeatherReport | null;
  loading: boolean;
  error: string | null;
  city: string;
}

let cache: WeatherState = {
  report: null,
  loading: false,
  error: null,
  city: getWeatherLocation().city,
};
let inflight: { key: string; version: number; promise: Promise<void> } | null = null;
let requestVersion = 0;
let lastFetch = 0;
let lastCoords = '';
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

async function fetchWeather(latitude: number, longitude: number) {
  const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  if (inflight?.key === key) return inflight.promise;

  const version = ++requestVersion;
  cache = { ...cache, loading: true, error: null };
  notify();
  const promise = (async () => {
    // Yield once so `inflight` is registered before the synchronous demo
    // provider can complete and clear it.
    await Promise.resolve();
    try {
      const report = isBrowserDemoMode()
        ? demoReport(latitude, longitude)
        : await TauriAPI.getWeather(latitude, longitude);
      if (version !== requestVersion) return;
      cache = { ...cache, report, loading: false, error: null };
      lastFetch = Date.now();
    } catch (err) {
      if (version !== requestVersion) return;
      // Keep the last good report: a transient fetch failure (e.g. network
      // not ready right after launch) must not flip the whole UI back to
      // the manual theme mid-day.
      cache = {
        ...cache,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      };
      lastFetch = Date.now() - REFRESH_MS + ERROR_RETRY_MS;
    } finally {
      if (version === requestVersion) {
        inflight = null;
        notify();
      }
    }
  })();
  inflight = { key, version, promise };
  return promise;
}

function demoReport(latitude: number, longitude: number): WeatherReport {
  const hour = new Date().getHours();
  return {
    latitude,
    longitude,
    temperature: 21,
    apparent_temperature: 20,
    humidity: 64,
    weather_code: hour >= 19 || hour < 6 ? 0 : 2,
    is_day: hour >= 6 && hour < 19,
    wind_speed: 12,
    wind_direction: 210,
    updated_at: Date.now(),
    daily: [],
  };
}

/** Shared weather for the configured city; refetches when the city changes. */
export function useWeather(): WeatherState {
  const [, force] = useState(0);

  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);

    const maybeRefresh = () => {
      const location = getWeatherLocation();
      const coords = `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`;
      const cityChanged = cache.city !== location.city;
      if (cityChanged) cache = { ...cache, city: location.city };
      if (lastCoords !== coords || Date.now() - lastFetch > REFRESH_MS) {
        lastCoords = coords;
        void fetchWeather(location.latitude, location.longitude);
      } else if (cityChanged) {
        notify();
      }
    };

    maybeRefresh();
    const timer = setInterval(maybeRefresh, 60 * 1000);
    window.addEventListener('wisp-settings-changed', maybeRefresh);
    return () => {
      listeners.delete(listener);
      clearInterval(timer);
      window.removeEventListener('wisp-settings-changed', maybeRefresh);
    };
  }, []);

  return cache;
}
