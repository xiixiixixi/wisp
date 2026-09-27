import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';
import en from '@/locales/en.json';
import zh from '@/locales/zh.json';

describe('Chinese and English catalogs', () => {
  it('has matching keys/placeholders and no unresolved static UI keys', () => {
    // vitest transpiles sources, so walk up from cwd to find the repo-root script.
    let script: string | null = null;
    for (let dir = process.cwd(); ; dir = resolve(dir, '..')) {
      const candidate = resolve(dir, 'scripts/audit-i18n.mjs');
      if (existsSync(candidate)) {
        script = candidate;
        break;
      }
      if (dir === resolve(dir, '..')) break;
    }
    if (!script) throw new Error('scripts/audit-i18n.mjs not found above cwd');
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
