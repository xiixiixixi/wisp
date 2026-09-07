import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useShortcuts, reloadShortcuts } from '@/hooks/use-shortcuts';

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    getShortcuts: vi.fn(async () => [
      { key_combination: 'enter', action: 'Rename', enabled: true, context: null },
      { key_combination: 'space', action: 'QuickLook', enabled: true, context: null },
      { key_combination: 'escape', action: 'ClearSelection', enabled: true, context: null },
    ]),
  },
}));
vi.mock('@/lib/transport', () => ({ listenToEvent: vi.fn(async () => vi.fn()) }));

describe('Global shortcuts and native controls', () => {
  it('leaves activation and menu keys to controls while preserving file shortcuts', async () => {
    const onRename = vi.fn();
    const onQuickLook = vi.fn();
    const onClearSelection = vi.fn();
    const onControlKey = vi.fn();
    function Fixture() {
      useShortcuts({ onRename, onQuickLook, onClearSelection });
      return (
        <>
          <button onKeyDown={onControlKey}>Sort</button>
          <div role="menu">
            <button role="menuitem" onKeyDown={onControlKey}>
              Name
            </button>
          </div>
          <div role="row" tabIndex={0}>
            File
          </div>
        </>
      );
    }
    render(<Fixture />);
    await act(async () => {
      reloadShortcuts();
    });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Sort' }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Sort' }), { key: ' ' });
    fireEvent.keyDown(screen.getByRole('menuitem'), { key: 'Escape' });
    expect(onControlKey).toHaveBeenCalledTimes(3);
    expect(onRename).not.toHaveBeenCalled();
    expect(onQuickLook).not.toHaveBeenCalled();
    expect(onClearSelection).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('row'), { key: 'Enter' });
    expect(onRename).toHaveBeenCalledOnce();
  });
});
