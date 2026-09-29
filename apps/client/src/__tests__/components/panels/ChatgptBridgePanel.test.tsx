import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ChatgptBridgePanel from '@/components/panels/ChatgptBridgePanel';
import { TauriAPI } from '@/lib/tauri-api';
import i18n from '@/i18n';
import { isTauri } from '@/lib/transport';

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

vi.mock('@/lib/transport', () => ({
  isTauri: vi.fn(() => false),
}));

const makeState = (overrides: Record<string, unknown> = {}) => ({
  config: {
    version: 1,
    enabled: false,
    tunnelId: '',
    tunnelClientPath: null,
    allowedRoots: [] as string[],
    maxFileBytes: 524288,
  },
  status: {
    state: 'stopped',
    enabled: false,
    pid: null,
    healthUrl: null,
    ready: null,
    restarts: 0,
    lastError: null,
    startedAt: null,
  },
  detectedClientPath: '/opt/homebrew/bin/tunnel-client',
  hasApiKey: false,
  configPath: '/tmp/chatgpt-bridge.json',
  wispExe: '/Applications/Wisp.app/Contents/MacOS/wisp',
  ...overrides,
});

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    chatgptBridgeGetState: vi.fn(),
    chatgptBridgeGetStatus: vi.fn(),
    chatgptBridgeSaveConfig: vi.fn(),
    chatgptBridgeSetApiKey: vi.fn(() => Promise.resolve()),
    chatgptBridgeDeleteApiKey: vi.fn(() => Promise.resolve()),
    chatgptBridgeRestart: vi.fn(() => Promise.resolve()),
    chatgptBridgeStop: vi.fn(() => Promise.resolve()),
    listenToChatgptBridgeStatus: vi.fn(() => Promise.resolve(() => {})),
    showOpenDialog: vi.fn(() => Promise.resolve(null)),
    openUrl: vi.fn(() => Promise.resolve()),
  },
}));

describe('ChatgptBridgePanel', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(makeState() as never);
    await i18n.changeLanguage('en');
  });

  it('shows the connection setup without repeating the sidebar title', async () => {
    render(<ChatgptBridgePanel currentPath="/Users/tc/git/wisp" />);
    await waitFor(() => expect(TauriAPI.chatgptBridgeGetState).toHaveBeenCalled());

    expect(screen.queryByText('ChatGPT Bridge')).not.toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByText(/It cannot change files through this connection/)).toBeInTheDocument();
    expect(screen.getByText('Install tunnel-client')).toBeInTheDocument();
    expect(screen.getByText('Tunnel ID')).toBeInTheDocument();
    expect(screen.getByText('Access key')).toBeInTheDocument();
    expect(screen.getByText('Shared folders (whitelist)')).toBeInTheDocument();
    expect(screen.getByText('Mount in ChatGPT')).toBeInTheDocument();
  });

  it('shows the detected tunnel-client path', async () => {
    render(<ChatgptBridgePanel />);
    await waitFor(() =>
      expect(screen.getByText(/\/opt\/homebrew\/bin\/tunnel-client/)).toBeInTheDocument(),
    );
  });

  it('warns when tunnel-client is missing', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
      makeState({ detectedClientPath: null }) as never,
    );
    render(<ChatgptBridgePanel />);
    await waitFor(() =>
      expect(
        screen.getByText('tunnel-client not detected yet — install it first.'),
      ).toBeInTheDocument(),
    );
  });

  it('allows an explicitly configured connection tool when auto-detection finds none', async () => {
    const configured = makeState({
      detectedClientPath: null,
      hasApiKey: true,
      config: {
        ...makeState().config,
        tunnelId: 'tunnel_manual',
        tunnelClientPath: '/custom/bin/tunnel-client',
        allowedRoots: ['/Users/tc/Documents'],
      },
    });
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(configured as never);
    vi.mocked(TauriAPI.chatgptBridgeSaveConfig).mockResolvedValue(
      makeState({
        ...configured,
        config: { ...configured.config, enabled: true },
      }) as never,
    );
    render(<ChatgptBridgePanel />);

    expect(
      await screen.findByText(/Configured connection tool: \/custom\/bin\/tunnel-client/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Enable bridge' }));
    await waitFor(() =>
      expect(TauriAPI.chatgptBridgeSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          tunnelClientPath: '/custom/bin/tunnel-client',
        }),
      ),
    );
  });

  it('surfaces the bridge error from the backend status', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
      makeState({
        status: { ...makeState().status, state: 'error', lastError: 'boom: bad key' },
      }) as never,
    );
    render(<ChatgptBridgePanel />);
    await waitFor(() => expect(screen.getByText('boom: bad key')).toBeInTheDocument());
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('distinguishes a one-time stop from turning off the bridge', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
      makeState({
        config: { ...makeState().config, enabled: true },
        status: { ...makeState().status, state: 'running', enabled: true },
      }) as never,
    );
    render(<ChatgptBridgePanel />);
    const stop = await screen.findByRole('button', { name: 'Stop for now' });
    expect(stop).toHaveAttribute('title', expect.stringContaining('Turn off Enable bridge'));
    expect(screen.getByRole('switch', { name: 'Enable bridge' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('adds the current folder to the whitelist and saves config with edits', async () => {
    vi.mocked(TauriAPI.chatgptBridgeSaveConfig).mockResolvedValue(
      makeState({
        config: {
          version: 1,
          enabled: true,
          tunnelId: 'tunnel_test',
          tunnelClientPath: null,
          allowedRoots: ['/Users/tc/git/wisp'],
          maxFileBytes: 524288,
        },
      }) as never,
    );
    render(<ChatgptBridgePanel currentPath="/Users/tc/git/wisp" />);

    await waitFor(() => expect(TauriAPI.chatgptBridgeGetState).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Current folder/ }));
    fireEvent.change(screen.getByPlaceholderText(/tunnel_/), {
      target: { value: 'tunnel_test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save & apply/ }));

    await waitFor(() => expect(TauriAPI.chatgptBridgeSaveConfig).toHaveBeenCalled());
    const saved = vi.mocked(TauriAPI.chatgptBridgeSaveConfig).mock.calls[0][0];
    expect(saved.tunnelId).toBe('tunnel_test');
    expect(saved.allowedRoots).toEqual(['/Users/tc/git/wisp']);
  });

  it('removes a whitelisted root', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
      makeState({
        config: {
          version: 1,
          enabled: false,
          tunnelId: '',
          tunnelClientPath: null,
          allowedRoots: ['/Users/tc/Downloads'],
          maxFileBytes: 524288,
        },
      }) as never,
    );
    render(<ChatgptBridgePanel />);
    await waitFor(() => expect(screen.getByText('/Users/tc/Downloads')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Remove folder' }));
    expect(screen.queryByText('/Users/tc/Downloads')).not.toBeInTheDocument();
  });

  it('does not offer Current folder when it is already whitelisted', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
      makeState({
        config: {
          version: 1,
          enabled: false,
          tunnelId: '',
          tunnelClientPath: null,
          allowedRoots: ['/Users/tc/git/wisp'],
          maxFileBytes: 524288,
        },
      }) as never,
    );
    render(<ChatgptBridgePanel currentPath="/Users/tc/git/wisp" />);
    await waitFor(() => expect(screen.getByText('/Users/tc/git/wisp')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Current folder/ })).not.toBeInTheDocument();
  });

  it('shows the privacy note about read-only not meaning private', async () => {
    render(<ChatgptBridgePanel />);
    await waitFor(() => expect(TauriAPI.chatgptBridgeGetState).toHaveBeenCalled());
    expect(screen.getByText(/Read-only ≠ private/)).toBeInTheDocument();
  });

  it('explains the bridge in browser preview and expands its help tip', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    render(<ChatgptBridgePanel />);
    expect(screen.getByText('Connect in the desktop app')).toBeInTheDocument();
    expect(screen.getByText(/read their contents/)).toBeInTheDocument();
    expect(TauriAPI.chatgptBridgeGetState).not.toHaveBeenCalled();
    const help = screen.getByRole('button', { name: 'How it works' });
    expect(help).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(help);
    expect(help).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('How to use it')).toBeVisible();
    expect(screen.getByText(/Read content is sent to OpenAI/)).toBeVisible();
  });

  it('shows a retry when the desktop state fails to load', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockRejectedValue(new Error('no ipc'));
    render(<ChatgptBridgePanel />);
    expect(
      await screen.findByText('Check that the desktop app is running, then try again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
  it('keeps unsaved connection drafts when a background status event arrives', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    render(<ChatgptBridgePanel />);
    const field = await screen.findByPlaceholderText(/tunnel_/);
    fireEvent.change(field, { target: { value: 'tunnel_unsaved' } });
    await waitFor(() => expect(TauriAPI.listenToChatgptBridgeStatus).toHaveBeenCalled());
    await act(async () => {
      vi.mocked(TauriAPI.listenToChatgptBridgeStatus).mock.calls[0][0](makeState().status as never);
    });
    expect(field).toHaveValue('tunnel_unsaved');
  });
  it('requires confirmation before deleting an existing key', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
      makeState({ hasApiKey: true }) as never,
    );
    render(<ChatgptBridgePanel />);
    const remove = await screen.findByRole('button', { name: 'Delete key' });
    fireEvent.click(remove);
    expect(TauriAPI.chatgptBridgeDeleteApiKey).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(TauriAPI.chatgptBridgeDeleteApiKey).not.toHaveBeenCalled();
  });
});
