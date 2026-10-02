import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    expect(result.current.sortBy).toBe('dateModified');
    expect(result.current.sortOrder).toBe('desc');
  });

  it('honors stored view and sorting choices', async () => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem(
      STORAGE_KEYS.UI_STATE,
      JSON.stringify({ viewMode: 'gallery', sortBy: 'name', sortOrder: 'asc' }),
    );
    const { useLayoutState } = await import('@/hooks/use-layout-state');
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => useLayoutState());
    expect(result.current.viewMode).toBe('gallery');
    expect(result.current.sortBy).toBe('name');
    expect(result.current.sortOrder).toBe('asc');
  });
});

describe('retired external assistant panel migration', () => {
  let originalWindowWidth: number;

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    originalWindowWidth = window.innerWidth;
    window.innerWidth = 1600;
  });

  afterEach(() => {
    window.innerWidth = originalWindowWidth;
  });

  it('falls back to preview without clearing unrelated saved state', async () => {
    const savedUiState = {
      rightPanelTab: 'agent-manager',
      viewMode: 'gallery',
      sortBy: 'name',
      sortOrder: 'asc',
      rightSidebarCollapsed: false,
      rightSidebarWidth: 340,
    };
    const savedSettings = { language: 'zh', showHiddenFiles: true };
    localStorage.setItem(STORAGE_KEYS.UI_STATE, JSON.stringify(savedUiState));
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(savedSettings));

    const { useLayoutState } = await import('@/hooks/use-layout-state');
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => useLayoutState());

    expect(result.current.rightPanelTab).toBe('preview');
    expect(result.current.viewMode).toBe('gallery');
    expect(result.current.sortBy).toBe('name');
    expect(result.current.sortOrder).toBe('asc');
    expect(result.current.rightSidebarCollapsed).toBe(false);
    expect(result.current.rightSidebarWidth).toBe(340);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.UI_STATE)!)).toMatchObject({
      viewMode: 'gallery',
      sortBy: 'name',
      sortOrder: 'asc',
      rightSidebarCollapsed: false,
      rightSidebarWidth: 340,
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!)).toEqual(savedSettings);
  });

  it.each(['chatgpt-bridge', 'chat', 'custom-extension-panel'])(
    'preserves the supported or custom panel %s',
    async (rightPanelTab) => {
      localStorage.setItem(STORAGE_KEYS.UI_STATE, JSON.stringify({ rightPanelTab }));
      const { useLayoutState } = await import('@/hooks/use-layout-state');
      const { renderHook } = await import('@testing-library/react');
      const { result } = renderHook(() => useLayoutState());

      expect(result.current.rightPanelTab).toBe(rightPanelTab);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.UI_STATE)!).rightPanelTab).toBe(
        rightPanelTab,
      );
    },
  );
});

describe('explorer initial sorting and grouping', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts an unseen folder modified-date descending and grouped by date', async () => {
    const { useFolderViewSettings } = await import('@/hooks/use-folder-view-settings');
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => useFolderViewSettings('/Users/test/Pictures', 'details'));

    expect(result.current.sortBy).toBe('dateModified');
    expect(result.current.sortOrder).toBe('desc');
    expect(result.current.groupByDate).toBe(true);
  });

  it('keeps explicit stored sorting and grouping choices', async () => {
    const path = '/Users/test/Pictures';
    localStorage.setItem(
      STORAGE_KEYS.UI_STATE,
      JSON.stringify({ sortBy: 'name', sortOrder: 'asc' }),
    );
    localStorage.setItem(
      STORAGE_KEYS.FOLDER_SETTINGS,
      JSON.stringify({ [path]: { groupByDate: false } }),
    );
    const { useFolderViewSettings } = await import('@/hooks/use-folder-view-settings');
    const { renderHook } = await import('@testing-library/react');
    const { result } = renderHook(() => useFolderViewSettings(path, 'details'));

    expect(result.current.sortBy).toBe('name');
    expect(result.current.sortOrder).toBe('asc');
    expect(result.current.groupByDate).toBe(false);
  });
});
