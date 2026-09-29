import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Settings from '@/pages/settings';
import { STORAGE_KEYS } from '@/lib/storage-keys';

const backend = vi.hoisted(() => ({ transport: vi.fn() }));
vi.mock('@/lib/transport', () => ({
  isTauri: () => true,
  transport: (...args: unknown[]) => backend.transport(...args),
}));
vi.mock('@/components/settings/AboutSettings', () => ({ default: () => <div>About Wisp</div> }));
vi.mock('@/components/settings/ShortcutsSettings', () => ({ default: () => <div>Shortcuts</div> }));
vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    mem0ConfigState: vi.fn(async () => ({
      enabled: false,
      has_key: false,
      user_id: 'wisp',
      auto_capture: true,
    })),
  },
}));
vi.mock('@/lib/native-appearance', () => ({ syncNativeAppearance: vi.fn(async () => {}) }));
vi.mock('@/lib/pi-engine/providers', () => ({ invalidatePiConfig: vi.fn() }));
vi.mock('@/lib/pi-engine/mem0', () => ({ invalidateMem0State: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  backend.transport.mockImplementation(async (cmd: string) => {
    if (cmd === 'mcp_config_get') return {};
    if (cmd === 'mcp_config_set') return;
    if (cmd === 'pi_config_state') {
      return {
        models_json: { providers: {} },
        auth_status: [],
        models_path: '/m',
        auth_path: '/a',
      };
    }
    throw new Error(cmd);
  });
});
const openTools = async () => {
  fireEvent.click(screen.getByRole('tab', { name: 'Tool connections' }));
  await waitFor(() => expect(screen.getByTestId('mcp-add')).not.toBeDisabled());
  fireEvent.click(screen.getByTestId('mcp-add'));
  fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'my-tool' } });
  fireEvent.change(screen.getByLabelText('Start command'), { target: { value: 'node' } });
};

describe('settings draft protection', () => {
  it('keeps an assistant draft across category changes and confirms before closing', async () => {
    const close = vi.fn();
    render(<Settings onClose={close} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Assistant' }));
    await act(async () => {});
    fireEvent.click(screen.getByTestId('pi-add-provider'));
    fireEvent.change(screen.getByLabelText('Service URL'), {
      target: { value: 'https://my-draft.test' },
    });
    expect(screen.getByText('You have unsaved changes')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'File Explorer' }));
    expect(screen.getByLabelText('Service URL')).not.toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Assistant' }));
    expect(screen.getByLabelText('Service URL')).toHaveValue('https://my-draft.test');
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Service URL')).toHaveValue('https://my-draft.test');
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings' }), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Discard and close' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('preserves tool edits when switching pages and cannot close while a save is pending', async () => {
    let resolveSave!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    backend.transport.mockImplementation(async (cmd: string) => {
      if (cmd === 'mcp_config_get') return {};
      if (cmd === 'mcp_config_set') return pending;
      throw new Error(cmd);
    });
    const close = vi.fn();
    render(<Settings onClose={close} />);
    await openTools();
    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Tool connections' }));
    expect(screen.getByLabelText('Connection name')).toHaveValue('my-tool');
    fireEvent.click(screen.getByTestId('mcp-edit-save'));
    expect(screen.getByTestId('mcp-edit-save')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(screen.getByText(/save is in progress/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Discard and close' })).not.toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await act(async () => resolveSave());
    await screen.findByTestId('mcp-server-row-my-tool');
    expect(screen.queryByText('You have unsaved changes')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps preference changes after storage failure and retries instead of announcing success', async () => {
    localStorage.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({ appearance: 'light', language: 'en' }),
    );
    render(<Settings />);
    const original = Storage.prototype.setItem;
    const fail = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === STORAGE_KEYS.SETTINGS) throw new Error('quota');
      return original.call(this, key, value);
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save preferences');
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!).appearance).toBe('light');
    fail.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!).appearance).toBe('dark'),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
