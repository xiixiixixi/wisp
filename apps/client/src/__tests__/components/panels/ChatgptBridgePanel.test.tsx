import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ChatgptBridgePanel from '@/components/panels/ChatgptBridgePanel';
import { TauriAPI } from '@/lib/tauri-api';
import i18n from '@/i18n';
import { isTauri } from '@/lib/transport';

vi.unmock('react-i18next');

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

vi.mock('@/lib/transport', () => ({
  isTauri: vi.fn(() => false),
}));

const tunnelId = 'tunnel_0123456789abcdef0123456789abcdef';
const selectedFolder = '/Users/tc/Documents/Wisp shared';
const clipboardWrite = vi.fn((_value: string) => Promise.resolve());

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

const configuredState = (enabled = false) =>
  makeState({
    hasApiKey: true,
    config: {
      ...makeState().config,
      enabled,
      tunnelId,
      allowedRoots: [selectedFolder],
    },
  });

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    chatgptBridgeGetState: vi.fn(),
    chatgptBridgeGetStatus: vi.fn(),
    chatgptBridgeSaveConfig: vi.fn(),
    chatgptBridgeSetApiKey: vi.fn(),
    chatgptBridgeDeleteApiKey: vi.fn(),
    chatgptBridgeRestart: vi.fn(),
    chatgptBridgeStop: vi.fn(),
    listenToChatgptBridgeStatus: vi.fn(),
    showOpenDialog: vi.fn(),
    openUrl: vi.fn(),
  },
}));

describe('ChatgptBridgePanel', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(makeState() as never);
    vi.mocked(TauriAPI.chatgptBridgeSaveConfig).mockResolvedValue(configuredState(true) as never);
    vi.mocked(TauriAPI.chatgptBridgeSetApiKey).mockResolvedValue(undefined);
    vi.mocked(TauriAPI.chatgptBridgeDeleteApiKey).mockResolvedValue(undefined);
    vi.mocked(TauriAPI.chatgptBridgeRestart).mockResolvedValue(undefined);
    vi.mocked(TauriAPI.chatgptBridgeStop).mockResolvedValue(undefined);
    vi.mocked(TauriAPI.listenToChatgptBridgeStatus).mockResolvedValue(() => {});
    vi.mocked(TauriAPI.showOpenDialog).mockResolvedValue(null);
    vi.mocked(TauriAPI.openUrl).mockResolvedValue(undefined);
    clipboardWrite.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    await i18n.changeLanguage('en');
  });

  it('starts with folder selection and shows only the current setup step', async () => {
    render(<ChatgptBridgePanel currentPath="/Users/tc/git/wisp" />);

    expect(await screen.findByText('Connection component ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Folders' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Connection' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'ChatGPT' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Add folder' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Current folder' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.queryByLabelText('Tunnel ID')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Access key')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open ChatGPT plugins' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Enable bridge' })).not.toBeInTheDocument();
    expect(screen.queryByText('ChatGPT Bridge')).not.toBeInTheDocument();
    expect(screen.queryByText('Install tunnel-client')).not.toBeInTheDocument();
    expect(screen.queryByText(/brew install|Run in Terminal/)).not.toBeInTheDocument();
    expect(screen.getByText(/cannot change files through this connection/)).toBeInTheDocument();
  });

  it.each([
    ['Connection', false, tunnelId, [selectedFolder]],
    ['Connection', true, '', [selectedFolder]],
    ['ChatGPT', true, tunnelId, [selectedFolder]],
    ['Folders', true, tunnelId, []],
  ])('opens %s for existing configuration', async (step, hasApiKey, id, allowedRoots) => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
      makeState({
        hasApiKey,
        config: { ...makeState().config, tunnelId: id, allowedRoots },
      }) as never,
    );
    render(<ChatgptBridgePanel />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: step })).toHaveAttribute('aria-current', 'step'),
    );
  });

  it('connects automatically after choosing folders and filling in the connection', async () => {
    vi.mocked(TauriAPI.showOpenDialog).mockResolvedValue([selectedFolder]);
    render(<ChatgptBridgePanel currentPath="/Users/tc/Private" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add folder' }));
    expect(await screen.findByText(selectedFolder)).toBeInTheDocument();
    expect(TauriAPI.showOpenDialog).toHaveBeenCalledWith({ directory: true, multiple: false });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('button', { name: 'Connection' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(screen.queryByRole('button', { name: 'Add folder' })).not.toBeInTheDocument();

    const connect = screen.getByRole('button', { name: 'Save & connect' });
    expect(connect).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Tunnel ID'), { target: { value: ` ${tunnelId} ` } });
    expect(connect).toBeDisabled();
    const key = screen.getByLabelText('Access key');
    expect(key).toHaveAttribute('type', 'password');
    fireEvent.change(key, { target: { value: ' sk-runtime-secret ' } });
    expect(connect).toBeEnabled();
    fireEvent.click(connect);

    await waitFor(() =>
      expect(TauriAPI.chatgptBridgeSetApiKey).toHaveBeenCalledWith('sk-runtime-secret'),
    );
    expect(TauriAPI.chatgptBridgeSaveConfig).toHaveBeenCalledWith({
      ...makeState().config,
      enabled: true,
      tunnelId,
      allowedRoots: [selectedFolder],
    });
    expect(screen.getByRole('button', { name: 'ChatGPT' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Add to ChatGPT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy test request' })).toBeDisabled();
    expect(clipboardWrite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connection' }));
    expect(screen.getByLabelText('Access key')).toHaveValue('');
  });

  it('connects an existing configuration with a stored key without asking for it again', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(configuredState() as never);
    render(<ChatgptBridgePanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Save & connect' }));
    await waitFor(() =>
      expect(TauriAPI.chatgptBridgeSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, tunnelId, allowedRoots: [selectedFolder] }),
      ),
    );
    expect(TauriAPI.chatgptBridgeSetApiKey).not.toHaveBeenCalled();
  });

  it('prevents duplicate submissions and edits while a connection is being saved', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(configuredState() as never);
    let finishSave!: (state: ReturnType<typeof makeState>) => void;
    vi.mocked(TauriAPI.chatgptBridgeSaveConfig).mockImplementation(
      () =>
        new Promise<ReturnType<typeof makeState>>((resolve) => {
          finishSave = resolve;
        }) as never,
    );
    render(<ChatgptBridgePanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Connection' }));
    const connect = screen.getByRole('button', { name: 'Save & connect' });
    fireEvent.click(connect);
    expect(connect).toBeDisabled();
    expect(screen.getByLabelText('Tunnel ID')).toBeDisabled();
    expect(screen.getByLabelText('Access key')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Folders' })).toBeDisabled();
    fireEvent.click(connect);
    expect(TauriAPI.chatgptBridgeSaveConfig).toHaveBeenCalledTimes(1);

    await act(async () => finishSave(configuredState(true)));
    expect(screen.getByRole('button', { name: 'ChatGPT' })).toHaveAttribute('aria-current', 'step');
  });

  it('warns when the bundled connection component is missing and prevents connecting', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
      makeState({ ...configuredState(), detectedClientPath: null }) as never,
    );
    render(<ChatgptBridgePanel />);

    expect(
      await screen.findByText('Connection component missing. Update or reinstall Wisp.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save & connect' })).toBeDisabled();
    expect(screen.queryByText(/brew install|Install tunnel-client/)).not.toBeInTheDocument();
    expect(TauriAPI.chatgptBridgeSaveConfig).not.toHaveBeenCalled();
  });

  it('accepts an explicitly configured connection component after it is detected', async () => {
    const configured = makeState({
      ...configuredState(),
      detectedClientPath: '/custom/bin/tunnel-client',
      config: { ...configuredState().config, tunnelClientPath: '/custom/bin/tunnel-client' },
    });
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(configured as never);
    vi.mocked(TauriAPI.chatgptBridgeSaveConfig).mockResolvedValue(
      makeState({ ...configured, config: { ...configured.config, enabled: true } }) as never,
    );
    render(<ChatgptBridgePanel />);

    expect(await screen.findByText('Connection component ready')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save & connect' }));
    await waitFor(() =>
      expect(TauriAPI.chatgptBridgeSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, tunnelClientPath: '/custom/bin/tunnel-client' }),
      ),
    );
  });

  it('recovers an invalid custom component path without enabling the connection', async () => {
    const configured = makeState({
      ...configuredState(),
      detectedClientPath: null,
      config: {
        ...configuredState().config,
        tunnelClientPath: '/old/bin/tunnel-client',
      },
    });
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(configured as never);
    vi.mocked(TauriAPI.chatgptBridgeSaveConfig).mockResolvedValue(
      makeState({
        ...configured,
        detectedClientPath: '/Applications/Wisp.app/Contents/Resources/binaries/tunnel-client',
        config: { ...configured.config, tunnelClientPath: null },
      }) as never,
    );
    render(<ChatgptBridgePanel />);

    expect(
      await screen.findByText('Connection component missing. Update or reinstall Wisp.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save & connect' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Use bundled component' }));
    await waitFor(() =>
      expect(TauriAPI.chatgptBridgeSaveConfig).toHaveBeenCalledWith({
        ...configured.config,
        enabled: false,
        tunnelClientPath: null,
      }),
    );
    expect(await screen.findByText('Connection component ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save & connect' })).toBeEnabled();
    expect(TauriAPI.chatgptBridgeSetApiKey).not.toHaveBeenCalled();
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it('opens the official setup pages from the connection step', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
      makeState({ config: { ...makeState().config, allowedRoots: [selectedFolder] } }) as never,
    );
    render(<ChatgptBridgePanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create connection' }));
    expect(TauriAPI.openUrl).toHaveBeenLastCalledWith(
      'https://platform.openai.com/settings/organization/tunnels',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create runtime key' }));
    expect(TauriAPI.openUrl).toHaveBeenLastCalledWith(
      'https://platform.openai.com/settings/organization/api-keys',
    );
  });

  it('opens the ChatGPT plugins page from the final step', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(configuredState() as never);
    render(<ChatgptBridgePanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open ChatGPT plugins' }));
    expect(TauriAPI.openUrl).toHaveBeenCalledWith('https://chatgpt.com/plugins');
  });

  it.each(['en', 'zh'])(
    'shows the plugin form choices without opening help in %s',
    async (language) => {
      await i18n.changeLanguage(language);
      vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(configuredState() as never);
      render(<ChatgptBridgePanel />);

      const guide = await screen.findByRole('group', {
        name: i18n.t('chatgptBridge.pluginFormTitle'),
      });
      expect(guide).toBeVisible();
      expect(guide.closest('details')).toBeNull();
      expect(within(guide).getByText(i18n.t('chatgptBridge.pluginAppTypeValue'))).toHaveTextContent(
        'MCP',
      );
      expect(
        within(guide).getByText(i18n.t('chatgptBridge.pluginConnectionTypeValue')),
      ).toHaveTextContent('Tunnel');
      expect(
        within(guide).getByText(i18n.t('chatgptBridge.pluginAuthenticationValue')),
      ).toBeVisible();
      const authNote = within(guide).getByText(i18n.t('chatgptBridge.pluginAuthNote'));
      expect(authNote).toHaveTextContent(
        language === 'zh' ? '无需 OAuth' : 'does not require OAuth',
      );
      expect(authNote).toHaveTextContent(
        language === 'zh' ? '运行密钥只填在 Wisp' : 'only in Wisp',
      );
      expect(within(guide).getByText(tunnelId)).toBeVisible();
      expect(
        within(guide).getByRole('button', { name: i18n.t('chatgptBridge.copyTunnelId') }),
      ).toBeEnabled();
      expect(screen.queryByLabelText(i18n.t('chatgptBridge.step3Title'))).not.toBeInTheDocument();
      expect(TauriAPI.chatgptBridgeSetApiKey).not.toHaveBeenCalled();
      expect(TauriAPI.chatgptBridgeSaveConfig).not.toHaveBeenCalled();
    },
  );

  it('copies only the connection ID and a test request, never the access key', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
      makeState({
        ...configuredState(true),
        status: { ...makeState().status, state: 'running', enabled: true, ready: true },
      }) as never,
    );
    render(<ChatgptBridgePanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Connection' }));
    fireEvent.change(screen.getByLabelText('Access key'), {
      target: { value: 'sk-private-draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy connection ID' }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith(tunnelId));
    fireEvent.click(screen.getByRole('button', { name: 'Connection' }));
    fireEvent.change(screen.getByLabelText('Access key'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy test request' }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(2));
    expect(clipboardWrite.mock.calls[1][0]).toBe(i18n.t('chatgptBridge.testPrompt'));
    expect(clipboardWrite.mock.calls.flat().join(' ')).not.toContain('sk-private-draft');
    expect(TauriAPI.chatgptBridgeSetApiKey).not.toHaveBeenCalled();
    expect(screen.getByText('Computer online')).toBeInTheDocument();
  });

  it.each(['stopped', 'starting', 'error'])(
    'does not copy a test request while the computer is %s',
    async (state) => {
      vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
        makeState({ ...configuredState(true), status: { ...makeState().status, state } }) as never,
      );
      render(<ChatgptBridgePanel />);

      const copy = await screen.findByRole('button', { name: 'Copy test request' });
      expect(copy).toBeDisabled();
      fireEvent.click(copy);
      expect(clipboardWrite).not.toHaveBeenCalled();
    },
  );

  it.each([false, null])(
    'keeps an unready running connection in the connecting state (%s)',
    async (ready) => {
      vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
        makeState({
          ...configuredState(true),
          status: { ...makeState().status, state: 'running', enabled: true, ready },
        }) as never,
      );
      render(<ChatgptBridgePanel />);

      expect(await screen.findByText('Connecting')).toBeInTheDocument();
      expect(screen.queryByText('Computer online')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copy test request' })).toBeDisabled();
    },
  );

  it('keeps folder edits pending across steps and applies them before allowing a test request', async () => {
    const initial = makeState({
      ...configuredState(true),
      status: { ...makeState().status, state: 'running', enabled: true, ready: true },
    });
    const replacementFolder = '/Users/tc/New shared folder';
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(initial as never);
    vi.mocked(TauriAPI.chatgptBridgeSaveConfig).mockResolvedValue(
      makeState({
        ...initial,
        config: { ...initial.config, allowedRoots: [replacementFolder] },
      }) as never,
    );
    render(<ChatgptBridgePanel currentPath={replacementFolder} />);

    expect(await screen.findByText('Computer online')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy test request' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Folders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'Current folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT' }));
    expect(screen.getByText('Changes are not saved yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy test request' })).toBeDisabled();
    expect(TauriAPI.chatgptBridgeSaveConfig).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(TauriAPI.chatgptBridgeSaveConfig).toHaveBeenCalledWith({
        ...initial.config,
        enabled: true,
        allowedRoots: [replacementFolder],
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText('Changes are not saved yet.')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Copy test request' })).toBeEnabled();
  });

  it('stops sharing when the final shared folder is removed and saved', async () => {
    const initial = makeState({
      ...configuredState(true),
      status: { ...makeState().status, state: 'running', enabled: true, ready: true },
    });
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(initial as never);
    vi.mocked(TauriAPI.chatgptBridgeSaveConfig).mockResolvedValue(
      makeState({
        ...initial,
        config: { ...initial.config, enabled: false, allowedRoots: [] },
        status: makeState().status,
      }) as never,
    );
    render(<ChatgptBridgePanel />);

    expect(await screen.findByText('Computer online')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Folders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove folder' }));
    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT' }));
    expect(screen.getByText('Changes are not saved yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy test request' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));

    await waitFor(() =>
      expect(TauriAPI.chatgptBridgeSaveConfig).toHaveBeenCalledWith({
        ...initial.config,
        enabled: false,
        allowedRoots: [],
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('switch', { name: 'Enable bridge' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Copy test request' })).toBeDisabled();
    expect(TauriAPI.chatgptBridgeSetApiKey).not.toHaveBeenCalled();
  });

  it('surfaces the bridge error from the backend status', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
      makeState({
        status: { ...makeState().status, state: 'error', lastError: 'boom: bad key' },
      }) as never,
    );
    render(<ChatgptBridgePanel />);

    expect(await screen.findByText('boom: bad key')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('distinguishes a one-time stop from turning off the bridge', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
      makeState({
        ...configuredState(true),
        status: { ...makeState().status, state: 'running', enabled: true, ready: true },
      }) as never,
    );
    render(<ChatgptBridgePanel />);

    const stop = await screen.findByRole('button', { name: 'Stop for now' });
    expect(stop).toHaveAttribute('title', expect.stringContaining('Turn off Enable bridge'));
    expect(screen.getByRole('switch', { name: 'Enable bridge' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(stop);
    await waitFor(() => expect(TauriAPI.chatgptBridgeStop).toHaveBeenCalledTimes(1));
    expect(TauriAPI.chatgptBridgeSaveConfig).not.toHaveBeenCalled();
  });

  it('allows restarting an enabled bridge', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(configuredState(true) as never);
    render(<ChatgptBridgePanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(TauriAPI.chatgptBridgeRestart).toHaveBeenCalledTimes(1));
  });

  it('removes a selected folder before saving and keeps other folders private', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
      makeState({
        config: { ...makeState().config, allowedRoots: ['/Users/tc/Downloads'] },
      }) as never,
    );
    render(<ChatgptBridgePanel currentPath={selectedFolder} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Folders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Current folder' }));
    const removedFolder = screen.getByText('/Users/tc/Downloads').closest('li')!;
    fireEvent.click(within(removedFolder).getByRole('button', { name: 'Remove folder' }));
    expect(screen.queryByText('/Users/tc/Downloads')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('Tunnel ID'), { target: { value: tunnelId } });
    fireEvent.change(screen.getByLabelText('Access key'), { target: { value: 'sk-runtime' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & connect' }));

    await waitFor(() =>
      expect(TauriAPI.chatgptBridgeSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ allowedRoots: [selectedFolder] }),
      ),
    );
  });

  it('does not add the same current folder twice', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
      makeState({ config: { ...makeState().config, allowedRoots: [selectedFolder] } }) as never,
    );
    render(<ChatgptBridgePanel currentPath={selectedFolder} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Folders' }));
    expect(screen.getByText(selectedFolder)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Current folder' })).not.toBeInTheDocument();
  });

  it('shows the privacy note about read-only not meaning private', async () => {
    render(<ChatgptBridgePanel />);
    expect(await screen.findByText(/Read-only ≠ private/)).toBeInTheDocument();
  });

  it('explains the bridge in browser preview and expands its help tip', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    render(<ChatgptBridgePanel />);

    expect(screen.getByText('Connect in the desktop app')).toBeInTheDocument();
    expect(screen.getByText(/find files and read text/)).toBeInTheDocument();
    expect(TauriAPI.chatgptBridgeGetState).not.toHaveBeenCalled();
    const help = screen.getByRole('button', { name: 'How it works' });
    expect(help).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(help);
    expect(help).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('How to use it')).toBeVisible();
    expect(screen.getByText(/Read content is sent to OpenAI/)).toBeVisible();
  });

  it('retries a failed load and restores the appropriate setup step', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState)
      .mockRejectedValueOnce(new Error('no ipc'))
      .mockResolvedValue(configuredState() as never);
    render(<ChatgptBridgePanel />);

    expect(
      await screen.findByText('Check that the desktop app is running, then try again.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ChatGPT' })).toHaveAttribute(
        'aria-current',
        'step',
      ),
    );
  });

  it('keeps unsaved connection and folder drafts when a background status event arrives', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
      makeState({ config: { ...makeState().config, allowedRoots: [selectedFolder] } }) as never,
    );
    render(<ChatgptBridgePanel currentPath="/Users/tc/New folder" />);

    const field = await screen.findByLabelText('Tunnel ID');
    fireEvent.change(field, { target: { value: 'tunnel_unsaved' } });
    fireEvent.change(screen.getByLabelText('Access key'), { target: { value: 'sk-unsaved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Folders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Current folder' }));
    await waitFor(() => expect(TauriAPI.listenToChatgptBridgeStatus).toHaveBeenCalled());
    await act(async () => {
      vi.mocked(TauriAPI.listenToChatgptBridgeStatus).mock.calls[0][0](makeState().status as never);
    });
    expect(screen.getByText('/Users/tc/New folder')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connection' }));
    expect(screen.getByLabelText('Tunnel ID')).toHaveValue('tunnel_unsaved');
    expect(screen.getByLabelText('Access key')).toHaveValue('sk-unsaved');
    expect(TauriAPI.chatgptBridgeSaveConfig).not.toHaveBeenCalled();
  });

  it('preserves edits for retry when saving the connection fails', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
      makeState({ config: { ...makeState().config, allowedRoots: [selectedFolder] } }) as never,
    );
    vi.mocked(TauriAPI.chatgptBridgeSaveConfig).mockRejectedValueOnce(
      new Error('connection rejected'),
    );
    render(<ChatgptBridgePanel />);

    fireEvent.change(await screen.findByLabelText('Tunnel ID'), { target: { value: tunnelId } });
    fireEvent.change(screen.getByLabelText('Access key'), { target: { value: 'sk-runtime' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & connect' }));
    expect(await screen.findByText(/connection rejected/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connection' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(screen.getByLabelText('Tunnel ID')).toHaveValue(tunnelId);
  });

  it('requires confirmation before deleting an existing key', async () => {
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(configuredState() as never);
    render(<ChatgptBridgePanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Connection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete key' }));
    expect(TauriAPI.chatgptBridgeDeleteApiKey).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(TauriAPI.chatgptBridgeDeleteApiKey).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete key' }));
    vi.mocked(TauriAPI.chatgptBridgeGetState).mockResolvedValue(
      makeState({ ...configuredState(), hasApiKey: false }) as never,
    );
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete key' }));
    await waitFor(() => expect(TauriAPI.chatgptBridgeDeleteApiKey).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Save & connect' })).toBeDisabled();
  });
});
