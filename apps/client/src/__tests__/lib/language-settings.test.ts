import { describe, expect, it } from 'vitest';
import { DEFAULT_LANGUAGE, normalizeLanguage } from '@/lib/language-settings';

describe('language settings', () => {
  it('defaults to Chinese', () => {
    expect(DEFAULT_LANGUAGE).toBe('zh');
    expect(normalizeLanguage(undefined)).toBe('zh');
    expect(normalizeLanguage('')).toBe('zh');
  });

  it('normalizes supported locale variants', () => {
    expect(normalizeLanguage('zh-CN')).toBe('zh');
    expect(normalizeLanguage('en_US')).toBe('en');
    expect(normalizeLanguage('JA-jp')).toBe('ja');
    expect(normalizeLanguage('id-ID')).toBe('id');
  });

  it('falls back to Chinese for unsupported locales', () => {
    expect(normalizeLanguage('fr-FR')).toBe('zh');
  });
});
