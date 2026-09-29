import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import KeyboardShortcutsSettings from '@/components/KeyboardShortcutsSettings';
vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    getShortcuts: vi.fn(async () => [
      {
        id: 'copy',
        action: 'Copy',
        key_combination: 'meta+c',
        keys: ['meta', 'c'],
        description: 'Copy',
        enabled: true,
      },
    ]),
  },
}));
vi.mock('@/lib/shortcut-utils', () => ({
  getKeyString: (event: KeyboardEvent) => event.key,
  formatKeyComboForDisplay: (value: string) => value,
  getCategoryForAction: () => 'file-operations',
  getLabelForAction: () => 'Copy',
}));

describe('shortcut editing in preserved settings panels', () => {
  it('names the search and clear actions and pauses key capture in a hidden category', async () => {
    const { rerender } = render(<KeyboardShortcutsSettings active />);
    const search = await screen.findByRole('textbox', { name: 'Search keyboard shortcuts' });
    fireEvent.change(search, { target: { value: 'copy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear shortcut search' }));
    expect(search).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Change shortcut for Copy' }));
    const captured = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
    fireEvent(document, captured);
    expect(captured.defaultPrevented).toBe(true);
    rerender(<KeyboardShortcutsSettings active={false} />);
    const otherPageKey = new KeyboardEvent('keydown', {
      key: 'a',
      bubbles: true,
      cancelable: true,
    });
    fireEvent(document, otherPageKey);
    expect(otherPageKey.defaultPrevented).toBe(false);
    rerender(<KeyboardShortcutsSettings active />);
    expect(screen.getByRole('button', { name: 'Change shortcut for Copy' })).toHaveTextContent('x');
  });
});
