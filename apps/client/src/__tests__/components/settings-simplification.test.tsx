import { act, render, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import SkySync from '@/components/weather/SkySync';
import { migrateRetiredSettings, stripRetiredSettings } from '@/lib/retired-settings';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { DEFAULT_SETTINGS, migrateLegacyAiSettings } from '@/components/settings/shared';

const retired = {
  fontSize: 'xl',
  sidebarWidth: 'wide',
  enableAnimations: false,
  enableNotifications: false,
  autoSave: true,
  enableMarkdownPreview: false,
  reducedMotion: true,
  reduceTransparency: true,
  enhancedFocus: true,
  highContrast: true,
  fluidGlass: false,
  weatherSync: false,
};
const retained = {
  language: 'en',
  showHiddenFiles: true,
  defaultView: 'details',
  weatherCity: '北京',
  weatherLat: 39.9042,
  weatherLon: 116.4074,
  aiCustomProvider: 'ollama',
  extensionPreference: { keep: true },
};

describe('simplified settings migration', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });
  afterEach(() => {
    cleanup();
    document.documentElement.className = '';
  });

  it('removes retired fields without changing the caller or unrelated settings', () => {
    const original = { ...retired, ...retained };
    expect(stripRetiredSettings(original)).toEqual(retained);
    expect(original.fontSize).toBe('xl');
    for (const key of Object.keys(retired)) expect(DEFAULT_SETTINGS).not.toHaveProperty(key);
  });

  it('migrates persisted settings and the separate font preference idempotently', () => {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ ...retired, ...retained }));
    localStorage.setItem('wisp:font-size', 'xl');
    localStorage.setItem('wisp:auto-update-extensions', 'true');
    localStorage.setItem('wisp:last-export-date', '2026-09-08');
    localStorage.setItem(STORAGE_KEYS.UI_STATE, JSON.stringify({ leftSidebarWidth: 310 }));
    migrateRetiredSettings();
    const first = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    expect(JSON.parse(first!)).toEqual(retained);
    expect(localStorage.getItem('wisp:font-size')).toBeNull();
    expect(localStorage.getItem('wisp:auto-update-extensions')).toBeNull();
    expect(localStorage.getItem('wisp:last-export-date')).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.UI_STATE)!)).toEqual({
      leftSidebarWidth: 310,
    });
    migrateRetiredSettings();
    expect(localStorage.getItem(STORAGE_KEYS.SETTINGS)).toBe(first);
  });

  it('does not create settings on a fresh install or destroy malformed data', () => {
    migrateRetiredSettings();
    expect(localStorage.getItem(STORAGE_KEYS.SETTINGS)).toBeNull();
    localStorage.setItem(STORAGE_KEYS.SETTINGS, '{invalid');
    expect(migrateRetiredSettings).not.toThrow();
    expect(localStorage.getItem(STORAGE_KEYS.SETTINGS)).toBe('{invalid');
  });

  it('keeps the existing AI migration while stripping invisible overrides', () => {
    expect(
      migrateLegacyAiSettings({ ...retired, ...retained, aiServiceMode: 'cloud', theme: 'glass' }),
    ).toEqual({ ...retained, aiServiceMode: 'custom', theme: 'auto' });
  });

  it('applies fixed glass and removes old visual overrides on mount and restore', () => {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(retired));
    document.documentElement.className =
      'theme-rolex font-xl reduce-motion reduce-transparency enhanced-focus high-contrast';
    const { unmount } = render(<SkySync />);
    expect(document.documentElement.className).toBe('theme-light theme-fluid');
    act(() => {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ ...retired, ...retained }));
      document.documentElement.classList.add('font-large', 'reduce-motion');
      window.dispatchEvent(new CustomEvent('wisp-settings-changed'));
    });
    expect(document.documentElement.className).toBe('theme-light theme-fluid');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!)).toEqual(retained);
    unmount();
    document.documentElement.classList.add('font-large');
    window.dispatchEvent(new CustomEvent('wisp-settings-changed'));
    expect(document.documentElement).toHaveClass('font-large');
  });
});
