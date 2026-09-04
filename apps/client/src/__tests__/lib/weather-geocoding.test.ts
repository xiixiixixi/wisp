import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/transport', () => ({
  isTauri: () => false,
}));

import { geocodeWeatherCity } from '@/lib/weather-geocoding';

describe('weather geocoding in browser demo mode', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('resolves supported Chinese and English aliases without a backend', async () => {
    window.history.replaceState({}, '', '/?demo=1');

    await expect(geocodeWeatherCity('北京')).resolves.toEqual([
      expect.objectContaining({ name: '北京', latitude: 39.9042, longitude: 116.4074 }),
    ]);
    await expect(geocodeWeatherCity('San Francisco')).resolves.toEqual([
      expect.objectContaining({ name: 'San Francisco', latitude: 37.7749, longitude: -122.4194 }),
    ]);
  });

  it('returns no synthetic match for an unknown demo city', async () => {
    window.history.replaceState({}, '', '/?demo=1');
    await expect(geocodeWeatherCity('Not a real city')).resolves.toEqual([]);
  });
});
