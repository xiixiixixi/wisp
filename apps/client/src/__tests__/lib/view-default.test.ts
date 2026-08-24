import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrateLegacyDefaultView, DEFAULT_VIEW } from '@/lib/view-default';
import { STORAGE_KEYS } from '@/lib/storage-keys';

describe('view default migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to details', () => {
    expect(DEFAULT_VIEW).toBe('details');
  });

  it('rewrites the legacy medium default in ui-state, settings, and folder-settings', () => {
    localStorage.setItem(
      STORAGE_KEYS.UI_STATE,
      JSON.stringify({ viewMode: 'medium', sortBy: 'name' }),
    );
    localStorage.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({ defaultView: 'grid', language: 'zh' }),
    );
    localStorage.setItem(
      STORAGE_KEYS.FOLDER_SETTINGS,
      JSON.stringify({
        '/Users/tc/Documents': { viewMode: 'medium', sortBy: 'dateModified' },
        '/Users/tc/Pictures': { viewMode: 'gallery' },
      }),
    );

    migrateLegacyDefaultView();

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.UI_STATE)!).viewMode).toBe('details');
    // Unrelated fields survive
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.UI_STATE)!).sortBy).toBe('name');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!).defaultView).toBe('details');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!).language).toBe('zh');
    const folders = JSON.parse(localStorage.getItem(STORAGE_KEYS.FOLDER_SETTINGS)!);
    expect(folders['/Users/tc/Documents'].viewMode).toBe('details');
    expect(folders['/Users/tc/Documents'].sortBy).toBe('dateModified');
    // A deliberately chosen non-default view stays untouched
    expect(folders['/Users/tc/Pictures'].viewMode).toBe('gallery');
  });

  it('runs only once', () => {
    localStorage.setItem(STORAGE_KEYS.UI_STATE, JSON.stringify({ viewMode: 'medium' }));
    migrateLegacyDefaultView();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.UI_STATE)!).viewMode).toBe('details');

    // Simulate the old default coming back (e.g. another window) — second run must not touch it
    localStorage.setItem(STORAGE_KEYS.UI_STATE, JSON.stringify({ viewMode: 'medium' }));
    migrateLegacyDefaultView();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.UI_STATE)!).viewMode).toBe('medium');
  });

  it('leaves already-migrated state alone', () => {
    localStorage.setItem(STORAGE_KEYS.UI_STATE, JSON.stringify({ viewMode: 'details' }));
    localStorage.setItem(STORAGE_KEYS.FOLDER_SETTINGS, JSON.stringify({}));

    migrateLegacyDefaultView();

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.UI_STATE)!).viewMode).toBe('details');
  });
});

describe('explorer default view', () => {
  it('boots into details view on a fresh install', async () => {
    vi.resetModules();
    localStorage.clear();
    const { useLayoutState } = await import('@/hooks/use-layout-state');
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => useLayoutState());
    expect(result.current.viewMode).toBe('details');
  });

  it('honors a stored non-default view', async () => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.UI_STATE, JSON.stringify({ viewMode: 'gallery' }));
    const { useLayoutState } = await import('@/hooks/use-layout-state');
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => useLayoutState());
    expect(result.current.viewMode).toBe('gallery');
  });
});
