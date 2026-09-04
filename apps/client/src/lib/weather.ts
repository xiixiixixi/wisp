/**
 * Weather semantics for the ambient theme system.
 *
 * open-meteo returns WMO weather codes; everything downstream (home card,
 * the sky ground) works off the normalized WeatherKind here.
 */

export type WeatherKind =
  | 'clear'
  | 'partly'
  | 'cloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'storm';

export interface WeatherDescriptor {
  kind: WeatherKind;
  /** i18n key under weather.* */
  labelKey: string;
}

/** WMO weather interpretation codes → normalized kind. */
export function describeWeatherCode(code: number): WeatherDescriptor {
  if (code === 0) return { kind: 'clear', labelKey: 'weather.clear' };
  if (code === 1 || code === 2) return { kind: 'partly', labelKey: 'weather.partly' };
  if (code === 3) return { kind: 'overcast', labelKey: 'weather.overcast' };
  if (code === 45 || code === 48) return { kind: 'fog', labelKey: 'weather.fog' };
  if (code >= 51 && code <= 57) return { kind: 'drizzle', labelKey: 'weather.drizzle' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return { kind: 'rain', labelKey: 'weather.rain' };
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return { kind: 'snow', labelKey: 'weather.snow' };
  }
  if (code >= 95) return { kind: 'storm', labelKey: 'weather.storm' };
  return { kind: 'cloudy', labelKey: 'weather.cloudy' };
}

/**
 * The one sky ground a weather kind may claim. Clear and partly cloudy keep
 * the sun-phase ground — only weather that actually changes the light gets
 * its own stain. Ink on paper: no particles, no glows, one wash.
 */
export type SkyGround = 'clear' | 'gloom' | 'rain' | 'snow' | 'storm';

export function skyGround(code: number): SkyGround {
  const { kind } = describeWeatherCode(code);
  switch (kind) {
    case 'clear':
    case 'partly':
      return 'clear';
    case 'cloudy':
    case 'overcast':
    case 'fog':
      return 'gloom';
    case 'drizzle':
    case 'rain':
      return 'rain';
    case 'snow':
      return 'snow';
    case 'storm':
      return 'storm';
  }
}
