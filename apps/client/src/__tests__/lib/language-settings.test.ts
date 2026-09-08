import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_OPTIONS,
  SUPPORTED_LANGUAGES,
  getFormattingLocale,
  normalizeLanguage,
} from '@/lib/language-settings';

describe('language settings', () => {
  it('defaults to Chinese', () => {
    expect(DEFAULT_LANGUAGE).toBe('zh');
    expect(normalizeLanguage(undefined)).toBe('zh');
    expect(normalizeLanguage('')).toBe('zh');
  });

  it('normalizes supported locale variants', () => {
    expect(normalizeLanguage('zh-CN')).toBe('zh');
    expect(normalizeLanguage('en_US')).toBe('en');
    expect(normalizeLanguage(' EN-gb ')).toBe('en');
  });

  it('falls back to Chinese for unsupported locales', () => {
    expect(normalizeLanguage('fr-FR')).toBe('zh');
    expect(normalizeLanguage('JA-jp')).toBe('zh');
    expect(normalizeLanguage('id-ID')).toBe('zh');
    expect(normalizeLanguage(null)).toBe('zh');
  });

  it('offers only Chinese and English', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['zh', 'en']);
    expect(LANGUAGE_OPTIONS).toEqual([
      { value: 'zh', label: '中文' },
      { value: 'en', label: 'English' },
    ]);
  });

  it('formats dates and numbers using the selected app language', () => {
    expect(getFormattingLocale('en')).toBe('en-US');
    expect(getFormattingLocale('zh')).toBe('zh-CN');
  });
});
