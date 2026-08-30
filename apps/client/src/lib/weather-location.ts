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
