import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ChatgptBridgePanel from '@/components/panels/ChatgptBridgePanel';
import { TauriAPI } from '@/lib/tauri-api';
import i18n from '@/i18n';

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
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(makeState() as never);
    await i18n.changeLanguage('en');
  });

  it('renders the five setup steps and the stopped status pill', async () => {
    render(<ChatgptBridgePanel currentPath="/Users/tc/git/wisp" />);
    await waitFor(() => expect(TauriAPI.chatgptBridgeGetState).toHaveBeenCalled());

    expect(screen.getByText('ChatGPT Bridge')).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByText('Install tunnel-client')).toBeInTheDocument();
    expect(screen.getByText('Create a tunnel')).toBeInTheDocument();
    expect(screen.getByText('Runtime API key')).toBeInTheDocument();
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

  it('falls back to a desktop-only message when the state call fails', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockRejectedValue(new Error('no ipc'));
    render(<ChatgptBridgePanel />);
    await waitFor(() =>
      expect(screen.getByText('The bridge requires the desktop Wisp app.')).toBeInTheDocument(),
    );
  });
});
