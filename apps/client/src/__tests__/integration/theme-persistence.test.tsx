import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

/**
 * The root appearance owner stays mounted across Settings and the explorer.
 * Retired theme keys can still be read by compatibility code, but must not
 * override the appearance preference or remove its material class.
 */
vi.mock('wouter', async () => {
  const React = await import('react');
  return {
    useLocation: vi.fn(() => ['/settings', vi.fn()]),
    Route: ({ children }: { children: React.ReactNode }) => children,
    Link: ({ children, href }: { children: React.ReactNode; href: string }) =>
      React.createElement('a', { href }, children),
  };
});

vi.mock('@/lib/transport', () => ({ isTauri: () => false }));

vi.mock('@/hooks/use-vim-mode', () => ({
  isVimModeEnabled: vi.fn(() => false),
  setVimModeSetting: vi.fn(),
  isVimLearningModeEnabled: vi.fn(() => false),
  setVimLearningModeSetting: vi.fn(),
}));

// Exercise the real compatibility applyTheme function, not the setup stub.
vi.mock('@/lib/utils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/utils')>('@/lib/utils');
  return { ...actual };
});

import Settings from '@/pages/settings';
import SkySync from '@/components/weather/SkySync';
import { useThemeManager } from '@/hooks/use-theme-manager';
import { applyTheme } from '@/lib/utils';
import { STORAGE_KEYS } from '@/lib/storage-keys';

const FolderPage = () => {
  useThemeManager();
  return <main>Folder</main>;
};

const AppearanceHarness = ({ page }: { page: 'settings' | 'folder' }) => (
  <>
    <SkySync />
    {page === 'settings' ? <Settings /> : <FolderPage />}
  </>
);

const expectSystemAppearance = (dark: boolean) => {
  expect(document.documentElement).toHaveClass('theme-fluid', dark ? 'theme-rolex' : 'theme-light');
  expect(document.documentElement).not.toHaveClass(dark ? 'theme-light' : 'theme-rolex');
  expect(document.documentElement).not.toHaveClass('theme-glass');
};

describe('system appearance across Settings and the folder page', () => {
  let dark: boolean;
  let appearance: MediaQueryList;
  let restoreMatchMedia: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.className = '';
    dark = false;
    appearance = new EventTarget() as MediaQueryList;
    Object.defineProperties(appearance, {
      matches: { get: () => dark },
      media: { value: '(prefers-color-scheme: dark)' },
    });
    const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue(appearance);
    restoreMatchMedia = () => matchMedia.mockRestore();
  });

  afterEach(() => {
    cleanup();
    restoreMatchMedia();
    document.documentElement.className = '';
  });

  it.each([
    { legacyTheme: 'light', prefersDark: true },
    { legacyTheme: 'rolex', prefersDark: false },
    { legacyTheme: 'glass', prefersDark: true },
  ])('ignores legacy $legacyTheme polarity across navigation', ({ legacyTheme, prefersDark }) => {
    dark = prefersDark;
    localStorage.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({ theme: legacyTheme, language: 'en', showHiddenFiles: true }),
    );
    localStorage.setItem(STORAGE_KEYS.UI_STATE, JSON.stringify({ theme: legacyTheme }));
    document.documentElement.className = `theme-${legacyTheme}`;

    const { rerender } = render(<AppearanceHarness page="settings" />);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
    expectSystemAppearance(prefersDark);

    rerender(<AppearanceHarness page="folder" />);
    expect(screen.getByRole('main')).toHaveTextContent('Folder');
    expectSystemAppearance(prefersDark);

    act(() => {
      applyTheme(legacyTheme);
      window.dispatchEvent(new CustomEvent('wisp-settings-changed'));
    });
    expectSystemAppearance(prefersDark);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!)).toMatchObject({
      showHiddenFiles: true,
    });
  });

  it('responds to system appearance changes before and after navigation', () => {
    const { rerender } = render(<AppearanceHarness page="settings" />);
    expectSystemAppearance(false);

    act(() => {
      dark = true;
      appearance.dispatchEvent(new Event('change'));
    });
    expectSystemAppearance(true);

    rerender(<AppearanceHarness page="folder" />);
    expectSystemAppearance(true);
    act(() => {
      dark = false;
      appearance.dispatchEvent(new Event('change'));
    });
    expectSystemAppearance(false);

    rerender(<AppearanceHarness page="settings" />);
    expectSystemAppearance(false);
  });

  it('offers only the three appearance choices and keeps retired themes out of Settings', () => {
    render(<AppearanceHarness page="settings" />);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /theme|appearance/i })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Follow system' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Light' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Dark' })).not.toBeChecked();
    expect(screen.queryByText('Wisp Ink')).not.toBeInTheDocument();
    expect(screen.queryByText('Wisp Slate')).not.toBeInTheDocument();
    expect(screen.queryByText('Wisp Paper')).not.toBeInTheDocument();
  });

  it('persists explicit overrides through navigation and remount, then resumes system changes', () => {
    const { rerender, unmount } = render(<AppearanceHarness page="settings" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expectSystemAppearance(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!)).toMatchObject({
      appearance: 'dark',
    });

    act(() => {
      dark = true;
      appearance.dispatchEvent(new Event('change'));
      dark = false;
      appearance.dispatchEvent(new Event('change'));
    });
    expectSystemAppearance(true);

    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    act(() => {
      dark = true;
      appearance.dispatchEvent(new Event('change'));
    });
    expectSystemAppearance(false);
    rerender(<AppearanceHarness page="folder" />);
    expectSystemAppearance(false);
    unmount();
    document.documentElement.className = '';

    render(<AppearanceHarness page="settings" />);
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expectSystemAppearance(false);
    fireEvent.click(screen.getByRole('radio', { name: 'Follow system' }));
    expectSystemAppearance(true);
    act(() => {
      dark = false;
      appearance.dispatchEvent(new Event('change'));
    });
    expectSystemAppearance(false);
  });

  it('updates both the picker and document from another window without echoing storage writes', () => {
    render(<AppearanceHarness page="settings" />);
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!);
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ ...saved, appearance: 'dark' }));
    const save = vi.spyOn(Storage.prototype, 'setItem');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.SETTINGS })));
    expectSystemAppearance(true);
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(save).not.toHaveBeenCalled();
    save.mockRestore();

    act(() => {
      localStorage.removeItem(STORAGE_KEYS.SETTINGS);
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.SETTINGS }));
    });
    expect(screen.getByRole('radio', { name: 'Follow system' })).toBeChecked();
    expectSystemAppearance(false);
  });

  it('applies a standalone Settings selection with native keyboard controls and resets to system', async () => {
    dark = true;
    const user = userEvent.setup();
    render(<Settings />);
    expectSystemAppearance(true);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus());
    act(() => screen.getByRole('radio', { name: 'Follow system' }).focus());
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expectSystemAppearance(false);

    await user.click(await screen.findByRole('button', { name: 'Reset all settings to defaults' }));
    expect(screen.getByRole('radio', { name: 'Follow system' })).toBeChecked();
    expectSystemAppearance(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!)).toMatchObject({
      appearance: 'system',
    });
  });
});
