import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '@/components/settings/shared';
import { getWeatherLocation, setWeatherLocation } from '@/lib/weather-location';

describe('weather location storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('merges a resolved location without replacing unrelated settings', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_SETTINGS, fontSize: 'large', showHiddenFiles: true }),
    );
    const changed = vi.fn();
    window.addEventListener('wisp-settings-changed', changed, { once: true });

    setWeatherLocation({ city: ' 北京 ', latitude: 39.9042, longitude: 116.4074 });

    const persisted = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    expect(persisted).toMatchObject({
      fontSize: 'large',
      showHiddenFiles: true,
      weatherCity: '北京',
      weatherLat: 39.9042,
      weatherLon: 116.4074,
    });
    expect(getWeatherLocation()).toEqual({
      city: '北京',
      latitude: 39.9042,
      longitude: 116.4074,
    });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('rejects empty or non-finite locations', () => {
    expect(() =>
      setWeatherLocation({ city: ' ', latitude: Number.NaN, longitude: 116.4074 }),
    ).toThrow('Invalid weather location');
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
  });
});
