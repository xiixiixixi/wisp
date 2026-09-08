import i18n from '@/i18n';
import { getFormattingLocale } from './language-settings';

/** Resolve at display time, never at module initialization. */
export const getAppLocale = (): string =>
  getFormattingLocale(i18n.resolvedLanguage || i18n.language);

export const formatAppDuration = (seconds: number): string => {
  const format = (value: number, unit: 'second' | 'minute' | 'hour') =>
    new Intl.NumberFormat(getAppLocale(), { style: 'unit', unit, unitDisplay: 'long' }).format(
      value,
    );
  if (seconds < 60) return format(seconds, 'second');
  if (seconds < 3600) return format(Math.floor(seconds / 60), 'minute');
  return `${format(Math.floor(seconds / 3600), 'hour')} ${format(Math.floor((seconds % 3600) / 60), 'minute')}`;
};
