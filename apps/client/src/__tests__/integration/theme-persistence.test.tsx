import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

/**
 * End-to-end regression test for the theme-switching bug:
 * pick a theme in Settings, switch to the folder (explorer) page, and the
 * theme must NOT change. Mounts the real Settings page and the real
 * useThemeManager hook (the explorer's theme entry point) against real
 * localStorage.
 */

// Mock wouter for the Settings page
vi.mock('wouter', async () => {
  const React = await import('react');
  return {
    useLocation: vi.fn(() => ['/settings', vi.fn()]),
    Route: ({ children }: { children: React.ReactNode }) => children,
    Link: ({ children, href }: { children: React.ReactNode; href: string }) =>
      React.createElement('a', { href }, children),
  };
});

vi.mock('@/lib/transport', () => ({
  isTauri: () => false,
}));

// Radix select mock that wires Item clicks through Root's onValueChange
type MockProps = Record<string, unknown> & { children?: React.ReactNode };
type MockRef = React.Ref<HTMLElement>;
vi.mock('@radix-ui/react-select', async () => {
  const React = await import('react');
  const SelectCtx = React.createContext<{ onValueChange?: (value: string) => void }>({});
  const SelectProvider = SelectCtx.Provider;
  return {
    Root: ({ children, onValueChange }: MockProps) =>
      React.createElement(
        SelectProvider,
        { value: { onValueChange: onValueChange as (value: string) => void } },
        React.createElement('div', {}, children),
      ),
    Trigger: React.forwardRef(({ children, ...props }: MockProps, ref: MockRef) =>
      React.createElement('button', { ...props, ref }, children),
    ),
    Value: ({ children, placeholder }: MockProps) =>
      React.createElement('span', {}, children || (placeholder as string)),
    Content: ({ children }: MockProps) => React.createElement('div', {}, children),
    Item: React.forwardRef(({ children, value, ...props }: MockProps, ref: MockRef) => {
      const ctx = React.useContext(SelectCtx);
      return React.createElement(
        'div',
        {
          ...props,
          ref,
          role: 'option',
          'data-value': value as string,
          onClick: () => ctx.onValueChange?.(value as string),
        },
        children,
      );
    }),
    Icon: ({ children }: MockProps) => React.createElement('span', {}, children),
    Viewport: ({ children }: MockProps) => React.createElement('div', {}, children),
    ItemIndicator: ({ children }: MockProps) => React.createElement('span', {}, children),
    ItemText: ({ children }: MockProps) => React.createElement('span', {}, children),
    ScrollUpButton: React.forwardRef((props: MockProps, ref: MockRef) =>
      React.createElement('button', { ...props, ref }),
    ),
    ScrollDownButton: React.forwardRef((props: MockProps, ref: MockRef) =>
      React.createElement('button', { ...props, ref }),
    ),
    Portal: ({ children }: MockProps) => children,
    Group: ({ children }: MockProps) => React.createElement('div', {}, children),
    Label: ({ children }: MockProps) => React.createElement('span', {}, children),
    Separator: () => React.createElement('hr'),
  };
});

vi.mock('@/hooks/use-vim-mode', () => ({
  isVimModeEnabled: vi.fn(() => false),
  setVimModeSetting: vi.fn(),
  isVimLearningModeEnabled: vi.fn(() => false),
  setVimLearningModeSetting: vi.fn(),
}));

vi.mock('@/hooks/use-tour', () => ({
  startTour: vi.fn(),
  resetTourCompleted: vi.fn(),
}));

// The global setup mocks '@/lib/utils' with a stubbed applyTheme and no
// `themes` registry — this test needs the real implementations.
vi.mock('@/lib/utils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/utils')>('@/lib/utils');
  return { ...actual };
});

vi.mock('@/components/dialogs/BetaWarningDialog', () => ({
  resetBetaWarning: vi.fn(),
}));

import Settings from '@/pages/settings';
import { useThemeManager } from '@/hooks/use-theme-manager';
import { STORAGE_KEYS } from '@/lib/storage-keys';

const getHtmlThemeClass = (): string =>
  Array.from(document.documentElement.classList).find((c) => c.startsWith('theme-')) ?? '';

const mountFolderPageTheme = async (): Promise<string> => {
  // wisp.tsx (the folder page) initializes its theme exactly like this
  const { result } = renderHook(() => useThemeManager());
  await waitFor(() => {
    expect(getHtmlThemeClass()).not.toBe('');
  });
  return result.current.theme;
};

describe('theme persistence across settings → folder page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.className = '';
  });

  it('keeps the theme picked in Settings after switching to the folder page (regression)', async () => {
    // Fresh install: nothing stored, no legacy flags
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings');
    });

    // User picks "Wisp Slate" (glass) in the theme dropdown
    const slateOption = await screen.findByText('Wisp Slate');
    fireEvent.click(slateOption);

    // Settings applies it immediately…
    await waitFor(() => expect(getHtmlThemeClass()).toBe('theme-glass'));
    // …and persists it to the shared UI state
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.UI_STATE) || '{}').theme).toBe('glass');
    });
  });

  it.each([
    ['Wisp Slate', 'glass'],
    ['Wisp Paper', 'light'],
    ['Wisp Ink', 'rolex'],
  ])('%s picked in Settings stays active on the folder page', async (label, key) => {
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings');
    });

    fireEvent.click(await screen.findByText(label));
    await waitFor(() => expect(getHtmlThemeClass()).toBe(`theme-${key}`));

    // "Switch to the folder page": unmount Settings, mount the explorer theme
    const { unmount } = renderHook(() => useThemeManager());
    unmount();
    document.documentElement.className = '';
    const folderTheme = await mountFolderPageTheme();

    expect(folderTheme).toBe(key);
    expect(getHtmlThemeClass()).toBe(`theme-${key}`);
  });

  it('offers exactly the three built-in themes in the Settings dropdown', async () => {
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings');
    });

    expect(await screen.findByText('Wisp Ink')).toBeInTheDocument();
    expect(screen.getByText('Wisp Slate')).toBeInTheDocument();
    expect(screen.getByText('Wisp Paper')).toBeInTheDocument();
    expect(screen.queryByText('Tokyo Night')).not.toBeInTheDocument();
    expect(screen.queryByText('Dracula')).not.toBeInTheDocument();
  });

  it('the folder page also honors a theme stored only by an older settings write', async () => {
    // wisp:settings without wisp:ui-state (legacy stored preference)
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ theme: 'light' }));
    const folderTheme = await mountFolderPageTheme();
    expect(folderTheme).toBe('light');
    expect(getHtmlThemeClass()).toBe('theme-light');
  });
});
