import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const explorerLifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));

// Exercise real history updates, including legacy /settings links.
vi.mock('wouter', () => vi.importActual('wouter'));
vi.mock('@/lib/transport', () => ({ isTauri: () => false }));
vi.mock('@/lib/extension-host', () => ({ extensionHost: {} }));
vi.mock('@/components/UpdateBanner', () => ({ default: () => null }));
vi.mock('@/components/dialogs/XtensionInstallDialog', () => ({ default: () => null }));
vi.mock('@/components/KeyboardShortcutsSettings', () => ({ default: () => null }));

vi.mock('@/pages/wisp', async () => {
  const { useEffect, useState } = await import('react');
  return {
    default: function ExplorerStateProbe() {
      const [draft, setDraft] = useState('initial draft');
      useEffect(() => {
        explorerLifecycle.mount();
        return () => explorerLifecycle.unmount();
      }, []);
      return (
        <main data-testid="explorer">
          <input
            aria-label="Editor draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button onClick={() => window.dispatchEvent(new CustomEvent('wisp-open-settings'))}>
            Open settings
          </button>
        </main>
      );
    },
  };
});

import { AppWorkspace } from '@/App';

describe('settings overlay preserves the active workspace', () => {
  let restoreHistory = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    restoreHistory = () => {};
    history.replaceState(null, '', '/?demo=1');
  });

  afterEach(() => {
    cleanup();
    restoreHistory();
    history.replaceState(null, '', '/');
  });

  it('opens once from the event and closes without remounting or discarding a draft', async () => {
    const user = userEvent.setup();
    render(<AppWorkspace />);
    const explorer = screen.getByTestId('explorer');
    const workspace = explorer.parentElement!;
    const draft = screen.getByRole('textbox', { name: 'Editor draft' });
    const trigger = screen.getByRole('button', { name: 'Open settings' });
    fireEvent.change(draft, { target: { value: 'unsaved editor contents' } });
    expect(workspace).not.toHaveAttribute('inert');
    expect(workspace).not.toHaveAttribute('aria-hidden');

    await user.click(trigger);
    await screen.findByRole('dialog', { name: 'Settings' });
    expect(workspace).toHaveAttribute('inert');
    expect(workspace).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('textbox', { name: 'Editor draft' })).not.toBeInTheDocument();
    expect(draft).toHaveValue('unsaved editor contents');
    expect(location.pathname + location.search).toBe('/?demo=1');
    act(() => window.dispatchEvent(new CustomEvent('wisp-open-settings')));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('explorer')).toBe(explorer);
    expect(screen.getByRole('textbox', { name: 'Editor draft' })).toBe(draft);
    expect(draft).toHaveValue('unsaved editor contents');
    expect(workspace).not.toHaveAttribute('inert');
    expect(workspace).not.toHaveAttribute('aria-hidden');
    expect(explorerLifecycle.mount).toHaveBeenCalledOnce();
    expect(explorerLifecycle.unmount).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    await screen.findByRole('dialog', { name: 'Settings' });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(draft).toHaveValue('unsaved editor contents');
    expect(explorerLifecycle.mount).toHaveBeenCalledOnce();
    expect(explorerLifecycle.unmount).not.toHaveBeenCalled();
  });

  it('restores the provided menu trigger after the focused menu item has unmounted', async () => {
    const user = userEvent.setup();
    render(<AppWorkspace />);
    const trigger = screen.getByRole('button', { name: 'Open settings' });
    const menuItem = document.createElement('button');
    menuItem.textContent = 'Temporary menu item';
    screen.getByTestId('explorer').append(menuItem);
    menuItem.focus();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('wisp-open-settings', { detail: { returnFocus: trigger } }),
      );
      menuItem.remove();
    });
    await screen.findByRole('dialog', { name: 'Settings' });
    await waitFor(() => expect(screen.getByRole('tab', { name: 'General' })).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(menuItem.isConnected).toBe(false);
    expect(screen.getByTestId('explorer').parentElement).not.toHaveAttribute('inert');
  });

  it('closes a direct settings URL by replacing history while preserving its query and explorer instance', async () => {
    history.replaceState(null, '', '/settings?demo=1');
    const replace = vi.spyOn(history, 'replaceState');
    const push = vi.spyOn(history, 'pushState');
    restoreHistory = () => {
      replace.mockRestore();
      push.mockRestore();
    };
    render(<AppWorkspace />);
    const explorer = screen.getByTestId('explorer');
    expect(explorer.parentElement).toHaveAttribute('inert');
    await screen.findByRole('dialog', { name: 'Settings' });
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(location.pathname + location.search).toBe('/?demo=1');
    expect(replace).toHaveBeenCalledWith(null, '', '/?demo=1');
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('explorer')).toBe(explorer);
    expect(explorer.parentElement).not.toHaveAttribute('inert');
    expect(explorerLifecycle.mount).toHaveBeenCalledOnce();
    expect(explorerLifecycle.unmount).not.toHaveBeenCalled();
  });
});
