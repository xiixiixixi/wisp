import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';
import en from '@/locales/en.json';
import zh from '@/locales/zh.json';

describe('Chinese and English catalogs', () => {
  it('has matching keys/placeholders and no unresolved static UI keys', () => {
    const script = resolve(process.cwd(), 'scripts/audit-i18n.mjs');
    const report = JSON.parse(execFileSync(process.execPath, [script], { encoding: 'utf8' }));
    expect(report.parity).toEqual([]);
    expect(report.interpolation).toEqual([]);
    expect(report.missing).toEqual([]);
    // Feature removal may reduce the corpus; require a non-empty scan, not a frozen file count.
    expect(report.files).toBeGreaterThan(0);
  });

  it('handles English plurals and Chinese counts without English suffixes', async () => {
    const instance = createInstance();
    await instance.init({
      lng: 'en',
      interpolation: { escapeValue: false },
      resources: { en: { translation: en }, zh: { translation: zh } },
    });
    expect(instance.t('counts.files', { count: 1 })).toBe('1 file');
    expect(instance.t('counts.files', { count: 2 })).toBe('2 files');
    await instance.changeLanguage('zh');
    expect(instance.t('counts.files', { count: 1 })).toBe('1 个文件');
    expect(instance.t('counts.files', { count: 2 })).toBe('2 个文件');
    expect(instance.t('fileReference.symlinkTo', { target: '/文档/report.txt' })).toContain(
      '/文档/report.txt',
    );
  });
});
