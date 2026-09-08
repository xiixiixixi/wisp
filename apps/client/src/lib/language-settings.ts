export const SUPPORTED_LANGUAGES = ['zh', 'en'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: AppLanguage = 'zh';

export const LANGUAGE_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
];

/** Normalize browser/i18next locale variants such as zh-CN to a supported app language. */
export const normalizeLanguage = (language: unknown): AppLanguage => {
  if (typeof language !== 'string') return DEFAULT_LANGUAGE;
  const base = language.trim().toLowerCase().split(/[-_]/)[0];
  return base === 'en' || base === 'zh' ? base : DEFAULT_LANGUAGE;
};

export const getFormattingLocale = (language: unknown): string =>
  normalizeLanguage(language) === 'en' ? 'en-US' : 'zh-CN';
