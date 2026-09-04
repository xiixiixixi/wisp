/**
 * Weather location resolution: reads the user's city setting from the
 * persisted app settings (localStorage), falling back to Shanghai.
 * Deliberately storage-direct — the FX overlay and home card both need it
 * without prop-drilling through the shell.
 */
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '@/components/settings/shared';

export function isWeatherSyncEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) ?? '';
    if (!raw) return DEFAULT_SETTINGS.weatherSync;
    const parsed = JSON.parse(raw) as { weatherSync?: boolean };
    return parsed.weatherSync ?? DEFAULT_SETTINGS.weatherSync;
  } catch {
    return DEFAULT_SETTINGS.weatherSync;
  }
}

export interface WeatherLocation {
  city: string;
  latitude: number;
  longitude: number;
}

const FALLBACK: WeatherLocation = {
  city: DEFAULT_SETTINGS.weatherCity,
  latitude: DEFAULT_SETTINGS.weatherLat,
  longitude: DEFAULT_SETTINGS.weatherLon,
};

export function getWeatherLocation(): WeatherLocation {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) ?? '';
    if (!raw) return FALLBACK;
    const parsed = JSON.parse(raw) as {
      weatherCity?: string;
      weatherLat?: number;
      weatherLon?: number;
    };
    if (typeof parsed.weatherLat === 'number' && typeof parsed.weatherLon === 'number') {
      return {
        city: typeof parsed.weatherCity === 'string' ? parsed.weatherCity : FALLBACK.city,
        latitude: parsed.weatherLat,
        longitude: parsed.weatherLon,
      };
    }
  } catch {
    /* ignore parse errors */
  }
  return FALLBACK;
}

/**
 * Persist a resolved weather location without replacing unrelated settings.
 * Consumers listen for the shared settings event and refresh from storage.
 */
export function setWeatherLocation(location: WeatherLocation): void {
  const city = location.city.trim();
  if (!city || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
    throw new TypeError('Invalid weather location');
  }

  let current: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) current = { ...current, ...(JSON.parse(raw) as Record<string, unknown>) };
  } catch {
    // Recover from malformed persisted settings while keeping safe defaults.
  }

  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      ...current,
      weatherCity: city,
      weatherLat: location.latitude,
      weatherLon: location.longitude,
    }),
  );
  window.dispatchEvent(new CustomEvent('wisp-settings-changed'));
}
