import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STORAGE_KEYS } from '@/lib/storage-keys';

vi.mock('@/lib/transport', () => ({ isTauri: () => false }));

vi.mock('@/hooks/use-vim-mode', () => ({
  isVimModeEnabled: vi.fn(() => false),
  setVimModeSetting: vi.fn(),
  isVimLearningModeEnabled: vi.fn(() => false),
  setVimLearningModeSetting: vi.fn(),
}));

// Keep preference controls real; the full shortcut editor has its own tests.
vi.mock('@/components/KeyboardShortcutsSettings', () => ({
  default: () => <div data-testid="keyboard-shortcuts-settings">Keyboard Shortcuts Settings</div>,
}));

import Settings from '@/pages/settings';

const selectExplorer = () => fireEvent.click(screen.getByRole('tab', { name: 'File Explorer' }));

describe('Settings dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('names the modal and exposes only General and File Explorer categories', () => {
    render(<Settings />);
    const dialog = within(screen.getByRole('dialog', { name: 'Settings' }));
    expect(dialog.getByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
    expect(dialog.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'General',
      'File Explorer',
    ]);
    expect(dialog.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    expect(dialog.getByRole('tabpanel', { name: 'General' })).toBeInTheDocument();
    expect(dialog.getByText('Changes are saved automatically')).toBeInTheDocument();
    expect(dialog.queryByRole('link', { name: 'Back to Home' })).not.toBeInTheDocument();
  });

  it.each(['button', 'Escape'])('requests close with %s', (method) => {
    const close = vi.fn();
    render(<Settings onClose={close} />);
    if (method === 'button') {
      fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    } else {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    }
    expect(close).toHaveBeenCalledOnce();
  });

  it('switches linked categories with keyboard arrows and restores the tab stop', () => {
    render(<Settings />);
    const general = screen.getByRole('tab', { name: 'General' });
    const explorer = screen.getByRole('tab', { name: 'File Explorer' });
    general.focus();
    fireEvent.keyDown(general, { key: 'ArrowRight' });
    expect(explorer).toHaveFocus();
    expect(explorer).toHaveAttribute('aria-selected', 'true');
    expect(general).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel', { name: 'File Explorer' }).id).toBe(
      explorer.getAttribute('aria-controls'),
    );
    fireEvent.keyDown(explorer, { key: 'Home' });
    expect(general).toHaveFocus();
    expect(general).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tabpanel', { name: 'General' })).toBeInTheDocument();
  });

  it.each([undefined, 'zh-CN'])(
    'normalizes the language control from %s to Chinese',
    (language) => {
      if (language) localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ language }));
      render(<Settings />);
      expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent('中文');
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!).language).toBe('zh');
    },
  );

  it('keeps About links within General and reveals keyboard controls on demand', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    const about = within(screen.getByRole('region', { name: 'About' }));
    expect(about.getByRole('heading', { name: 'Wisp' })).toBeInTheDocument();
    expect(about.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/xiixiixixi/wisp',
    );
    const keyboard = screen.getByText('Keyboard').closest('summary')!;
    expect(keyboard.closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByTestId('keyboard-shortcuts-settings')).not.toBeInTheDocument();
    await user.click(keyboard);
    expect(await screen.findByRole('switch', { name: 'Vim Mode' })).toBeInTheDocument();
    expect(screen.getByTestId('keyboard-shortcuts-settings')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'About' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Shortcuts' })).not.toBeInTheDocument();
  });

  it('keeps reset directly visible in General', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ appearance: 'dark' }));
    render(<Settings />);
    expect(screen.queryByText('Advanced')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Reset all settings to defaults' }));
    expect(screen.getByRole('radio', { name: 'Follow system' })).toBeChecked();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!).appearance).toBe('system');
  });

  it.each([null, 'false', 'true'])(
    'does not change the saved extension update policy (%s)',
    (saved) => {
      if (saved !== null) localStorage.setItem('wisp:auto-update-extensions', saved);
      render(<Settings />);
      expect(localStorage.getItem('wisp:auto-update-extensions')).toBe(saved);
      expect(screen.queryByText('Auto-update extensions')).not.toBeInTheDocument();
    },
  );

  it('keeps file display controls and avoids duplicating hidden-files or retired controls', () => {
    render(<Settings />);
    selectExplorer();
    expect(screen.getByRole('combobox', { name: 'Default View' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'File Extensions' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Auto-Calculate Folder Sizes' })).toBeInTheDocument();
    expect(screen.queryByText('Show Hidden Files')).not.toBeInTheDocument();
    expect(screen.queryByText('Markdown Preview')).not.toBeInTheDocument();
    expect(screen.queryByText('File Associations')).not.toBeInTheDocument();
  });

  it('saves file-extension display changes immediately and retains them after reopening', async () => {
    const changed = vi.fn();
    window.addEventListener('wisp-settings-changed', changed);
    try {
      const { unmount } = render(<Settings />);
      selectExplorer();
      changed.mockClear();
      fireEvent.click(screen.getByRole('switch', { name: 'File Extensions' }));
      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!).showFileExtensions).toBe(
          false,
        ),
      );
      expect(changed).toHaveBeenCalled();
      unmount();
      render(<Settings />);
      selectExplorer();
      expect(screen.getByRole('switch', { name: 'File Extensions' })).not.toBeChecked();
    } finally {
      window.removeEventListener('wisp-settings-changed', changed);
    }
  });

  it('omits menu rule configuration when no rules have been saved', () => {
    render(<Settings />);
    selectExplorer();
    expect(screen.getByRole('switch', { name: 'File Extensions' })).toBeInTheDocument();
    expect(screen.queryByText('Advanced')).not.toBeInTheDocument();
    expect(screen.queryByText('Context menu visibility')).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEYS.CONTEXT_MENU_RULES)).toBeNull();
  });

  it('keeps existing menu rules manageable in Advanced without touching legacy opening data', async () => {
    const user = userEvent.setup();
    const oldOpenPrefs = JSON.stringify({ ts: 'wisp-editor' });
    const rules = [
      {
        id: 'existing-rule',
        menuItemId: 'compress',
        menuItemLabel: 'Compress',
        condition: 'show_only_for',
        matcher: { type: 'extension', value: '.zip' },
        enabled: true,
      },
    ];
    localStorage.setItem(STORAGE_KEYS.FILE_OPEN_PREFS, oldOpenPrefs);
    localStorage.setItem(STORAGE_KEYS.CONTEXT_MENU_RULES, JSON.stringify(rules));
    render(<Settings />);
    selectExplorer();
    const advanced = screen.getByText('Advanced').closest('summary')!;
    expect(advanced.closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByText('File Associations')).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEYS.FILE_OPEN_PREFS)).toBe(oldOpenPrefs);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CONTEXT_MENU_RULES)!)).toEqual(rules);
    await user.click(advanced);
    expect(await screen.findByText('Compress')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset to Defaults' }));
    expect(localStorage.getItem(STORAGE_KEYS.CONTEXT_MENU_RULES)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.FILE_OPEN_PREFS)).toBe(oldOpenPrefs);
  });

  it('migrates removed controls while preserving real preferences', async () => {
    localStorage.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({
        language: 'en',
        defaultView: 'list',
        showHiddenFiles: true,
        fontSize: 'large',
        fluidGlass: false,
        enableAnimations: false,
        highContrast: true,
      }),
    );
    render(<Settings />);
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!);
      expect(saved).toMatchObject({ language: 'en', defaultView: 'list', showHiddenFiles: true });
      for (const key of ['fontSize', 'fluidGlass', 'enableAnimations', 'highContrast']) {
        expect(saved).not.toHaveProperty(key);
      }
    });
  });
});
