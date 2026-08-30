/**
 * Weather semantics for the ambient theme system.
 *
 * open-meteo returns WMO weather codes; everything downstream (home card,
 * global WeatherFx overlay) works off the normalized WeatherKind here.
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

/** Sky scene the FX overlay renders: weather + day/night collapsed. */
export type SkyScene =
  | 'clear-day'
  | 'clear-night'
  | 'partly-day'
  | 'partly-night'
  | 'cloudy'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'storm';

export function skyScene(code: number, isDay: boolean): SkyScene {
  const { kind } = describeWeatherCode(code);
  switch (kind) {
    case 'clear':
      return isDay ? 'clear-day' : 'clear-night';
    case 'partly':
      return isDay ? 'partly-day' : 'partly-night';
    case 'cloudy':
    case 'overcast':
      return 'cloudy';
    case 'fog':
      return 'fog';
    case 'drizzle':
    case 'rain':
      return 'rain';
    case 'snow':
      return 'snow';
    case 'storm':
      return 'storm';
  }
}

/**
 * Moon phase, 0 = new moon → 0.5 = full moon → 1 = new moon again.
 * Standard approximation from a known new-moon epoch (2000-01-06 18:14 UTC),
 * synodic month 29.53058867d — good enough to light a decorative moon.
 */
export function moonPhase(date: Date = new Date()): number {
  const synodic = 29.53058867;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
  const days = date.getTime() / 86400000 - knownNewMoon;
  const phase = (days % synodic) / synodic;
  return phase < 0 ? phase + 1 : phase;
}

/** Human name for the phase (i18n key under weather.moon*). */
export function moonPhaseKey(phase: number): string {
  if (phase < 0.03 || phase > 0.97) return 'weather.moonNew';
  if (phase < 0.22) return 'weather.moonWaxingCrescent';
  if (phase < 0.28) return 'weather.moonFirstQuarter';
  if (phase < 0.47) return 'weather.moonWaxingGibbous';
  if (phase < 0.53) return 'weather.moonFull';
  if (phase < 0.72) return 'weather.moonWaningGibbous';
  if (phase < 0.78) return 'weather.moonLastQuarter';
  return 'weather.moonWaningCrescent';
}

/**
 * Illuminated fraction (0–1) and whether the lit limb is waxing (right side
 * grows) — drives the CSS moon shadow.
 */
export function moonRender(phase: number): { illuminated: number; waxing: boolean } {
  const illuminated = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  return { illuminated, waxing: phase <= 0.5 };
}
