export const DEFAULT_LANGUAGE = 'zh';

const SUPPORTED_LANGUAGES = new Set(['en', 'zh', 'ja', 'id']);

/** Normalize browser/i18next locale variants such as zh-CN to a supported app language. */
export const normalizeLanguage = (language: unknown): string => {
  if (typeof language !== 'string') return DEFAULT_LANGUAGE;
  const base = language.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LANGUAGES.has(base) ? base : DEFAULT_LANGUAGE;
};
