import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useShortcuts, reloadShortcuts } from '@/hooks/use-shortcuts';
import { listenToEvent } from '@/lib/transport';

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    getShortcuts: vi.fn(async () => [
      { key_combination: 'enter', action: 'Rename', enabled: true, context: null },
      { key_combination: 'space', action: 'QuickLook', enabled: true, context: null },
      { key_combination: 'escape', action: 'ClearSelection', enabled: true, context: null },
      ...[
        ['c', 'Copy'],
        ['x', 'Cut'],
        ['v', 'Paste'],
        ['a', 'SelectAll'],
        ['z', 'Undo'],
      ].map(([key, action]) => ({
        key_combination: `ctrl+${key}`,
        action,
        enabled: true,
        context: null,
      })),
      { key_combination: 'ctrl+alt+c', action: 'CopyPath', enabled: true, context: null },
    ]),
  },
}));
vi.mock('@/lib/transport', () => ({ listenToEvent: vi.fn(async () => vi.fn()) }));

describe('Global shortcuts and native controls', () => {
  afterEach(() => {
    cleanup();
    window.getSelection()?.removeAllRanges();
  });

  it.each(['dialog', 'alertdialog'])(
    'suspends native file actions until the %s closes',
    async (role) => {
      const onCopy = vi.fn();
      const onRename = vi.fn();
      function Fixture({ open }: { open: boolean }) {
        useShortcuts({ onCopy, onRename });
        return open ? (
          <div role={role} aria-modal="true">
            <button role="tab">General</button>
          </div>
        ) : null;
      }
      const { rerender } = render(<Fixture open />);
      await act(async () => {
        reloadShortcuts();
      });
      const registration = vi
        .mocked(listenToEvent)
        .mock.calls.filter(([name]) => name === 'global_shortcut_triggered')
        .at(-1);
      expect(registration).toBeDefined();
      const dispatchNative = registration![1];
      screen.getByRole('tab', { name: 'General' }).focus();
      act(() => {
        dispatchNative('Copy');
        dispatchNative('Rename');
      });
      expect(onCopy).not.toHaveBeenCalled();
      expect(onRename).not.toHaveBeenCalled();
      rerender(<Fixture open={false} />);
      act(() => {
        dispatchNative('Copy');
        dispatchNative('Rename');
      });
      expect(onCopy).toHaveBeenCalledOnce();
      expect(onRename).toHaveBeenCalledOnce();
    },
  );

  it('leaves all text edits to the focused field, not the selected files', async () => {
    const fileAction = vi.fn();
    function Fixture() {
      useShortcuts({
        onCopy: fileAction,
        onCut: fileAction,
        onPaste: fileAction,
        onSelectAll: fileAction,
        onUndo: fileAction,
      });
      return (
        <>
          <input aria-label="Rename file" defaultValue="文档.txt" />
          <textarea aria-label="Path" />
          <div contentEditable suppressContentEditableWarning>
            <span>Editor text</span>
          </div>
        </>
      );
    }
    render(<Fixture />);
    await act(async () => {
      reloadShortcuts();
    });
    for (const target of [
      screen.getByLabelText('Rename file'),
      screen.getByLabelText('Path'),
      screen.getByText('Editor text'),
    ]) {
      for (const key of ['c', 'x', 'v', 'a', 'z']) {
        expect(fireEvent.keyDown(target, { key, metaKey: true })).toBe(true);
      }
    }
    expect(fileAction).not.toHaveBeenCalled();
  });

  it('copies preview text before files, without breaking file/path copy shortcuts', async () => {
    const onCopy = vi.fn();
    const onCopyPath = vi.fn();
    function Fixture() {
      useShortcuts({ onCopy, onCopyPath });
      return (
        <>
          <p>Preview text</p>
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
    const preview = screen.getByText('Preview text');
    const range = document.createRange();
    range.selectNodeContents(preview);
    window.getSelection()?.addRange(range);
    expect(fireEvent.keyDown(preview, { key: 'c', metaKey: true })).toBe(true);
    expect(onCopy).not.toHaveBeenCalled();
    window.getSelection()?.removeAllRanges();
    fireEvent.keyDown(screen.getByRole('row'), { key: 'c', metaKey: true });
    fireEvent.keyDown(screen.getByRole('row'), {
      key: 'ç',
      code: 'KeyC',
      metaKey: true,
      altKey: true,
    });
    expect(onCopy).toHaveBeenCalledOnce();
    expect(onCopyPath).toHaveBeenCalledOnce();
  });

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
