import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAppearance, readAppearancePreference } from '@/lib/appearance';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import html from '../../../index.html?raw';

vi.mock('@/lib/transport', () => ({ isTauri: () => false }));

// Execute the actual pre-React script to catch drift between refresh and runtime.
const bootScript = html.match(/<script>([\s\S]*?)<\/script>/)![1];

describe('appearance before React loads', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    delete document.documentElement.dataset.wispAppearance;
  });

  it.each([
    { saved: null, systemDark: false, preference: 'system', dark: false },
    { saved: null, systemDark: true, preference: 'system', dark: true },
    { saved: '{"appearance":"system"}', systemDark: true, preference: 'system', dark: true },
    { saved: '{"appearance":"light"}', systemDark: true, preference: 'light', dark: false },
    { saved: '{"appearance":"dark"}', systemDark: false, preference: 'dark', dark: true },
    { saved: '{"theme":"rolex"}', systemDark: false, preference: 'system', dark: false },
    { saved: '{"appearance":"glass"}', systemDark: true, preference: 'system', dark: true },
    { saved: '{invalid', systemDark: true, preference: 'system', dark: true },
  ])('uses $preference with system dark=$systemDark from $saved', (testCase) => {
    if (testCase.saved) localStorage.setItem(STORAGE_KEYS.SETTINGS, testCase.saved);
    localStorage.setItem(STORAGE_KEYS.UI_STATE, '{"theme":"light"}');
    runInNewContext(bootScript, {
      document,
      localStorage,
      matchMedia: () => ({ matches: testCase.systemDark }),
    });
    const root = document.documentElement;
    expect(root).toHaveClass('theme-fluid', testCase.dark ? 'theme-rolex' : 'theme-light');
    expect(root).not.toHaveClass(testCase.dark ? 'theme-light' : 'theme-rolex');
    expect(root.dataset.wispAppearance).toBe(testCase.preference);
    const bootClasses = root.className;

    expect(readAppearancePreference()).toBe(testCase.preference);
    applyAppearance(readAppearancePreference(), testCase.systemDark);
    expect(root.className).toBe(bootClasses);
  });

  it('still follows the system when storage is unavailable', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    });
    try {
      runInNewContext(bootScript, {
        document,
        localStorage,
        matchMedia: () => ({ matches: true }),
      });
      expect(document.documentElement).toHaveClass('theme-rolex', 'theme-fluid');
      expect(readAppearancePreference()).toBe('system');
    } finally {
      read.mockRestore();
    }
  });
});
