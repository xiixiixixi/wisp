/**
 * MCP 设置页 —— 列表/开关/增删改/测连接，配置经 mcp_config_get/set 落盘。
 * transport 全 mock，只验 UI 行为不碰真 MCP。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import McpSettings from '@/components/settings/McpSettings';

const transportMock = vi.fn();
vi.mock('@/lib/transport', () => ({
  isTauri: () => true,
  transport: (...args: unknown[]) => transportMock(...args),
}));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));

const sampleConfig = {
  'web-reader': { type: 'http', url: 'https://e/mcp', enabled: true },
  figma: { type: 'stdio', command: 'npx', args: ['-y', 'figma-developer-mcp'], enabled: false },
};

describe('McpSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transportMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'mcp_config_get') return structuredClone(sampleConfig);
      if (cmd === 'mcp_config_set') return undefined;
      if (cmd === 'mcp_test_server') return { ok: true, toolCount: 3, tools: ['a', 'b', 'c'] };
      throw new Error(`unexpected command ${cmd}`);
    });
  });

  it('lists configured servers with type and state', async () => {
    render(<McpSettings />);
    expect(await screen.findByTestId('mcp-server-row-web-reader')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-server-row-figma')).toBeInTheDocument();
    expect(screen.getByText(/Network service · https:\/\/e\/mcp/)).toBeInTheDocument();
    expect(screen.getByText(/Local tool · npx -y figma-developer-mcp/)).toBeInTheDocument();
    // figma 禁用 → 开关 off
    const toggles = screen.getAllByRole('switch');
    expect(toggles[1]).toHaveAttribute('aria-checked', 'false');
  });

  it('toggling a server persists the flipped config', async () => {
    render(<McpSettings />);
    await screen.findByTestId('mcp-server-row-figma');
    fireEvent.click(screen.getAllByRole('switch')[1]);
    await waitFor(() =>
      expect(transportMock).toHaveBeenCalledWith('mcp_config_set', {
        config: {
          mcpServers: expect.objectContaining({
            figma: expect.objectContaining({ enabled: true }),
          }),
        },
      }),
    );
  });

  it('adding an http server validates URL then saves', async () => {
    render(<McpSettings />);
    await screen.findByTestId('mcp-server-row-web-reader');
    fireEvent.click(screen.getByTestId('mcp-add'));
    fireEvent.change(screen.getByTestId('mcp-edit-name'), { target: { value: 'search' } });
    // 先选 http 但不填 URL → 提示
    fireEvent.click(screen.getByRole('radio', { name: 'Network service' }));
    fireEvent.click(screen.getByTestId('mcp-edit-save'));
    await waitFor(() =>
      expect(transportMock.mock.calls.some((c) => c[0] === 'mcp_config_set')).toBe(false),
    ); // 未触发保存

    fireEvent.change(screen.getByLabelText('Service address'), {
      target: { value: 'https://s/mcp' },
    });
    fireEvent.click(screen.getByTestId('mcp-edit-save'));
    await waitFor(() =>
      expect(transportMock).toHaveBeenCalledWith('mcp_config_set', {
        config: {
          mcpServers: expect.objectContaining({
            search: expect.objectContaining({ type: 'http', url: 'https://s/mcp' }),
          }),
        },
      }),
    );
  });

  it('test connection shows tool count', async () => {
    render(<McpSettings />);
    await screen.findByTestId('mcp-test-web-reader');
    fireEvent.click(screen.getByTestId('mcp-test-web-reader'));
    await waitFor(() =>
      expect(screen.getByTestId('mcp-test-result-web-reader')).toHaveTextContent(/3/),
    );
  });
});

describe('connection edit recovery', () => {
  let failSave: boolean;
  beforeEach(() => {
    vi.clearAllMocks();
    failSave = true;
    transportMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'mcp_config_get') return structuredClone(sampleConfig);
      if (cmd === 'mcp_config_set') {
        if (failSave) throw new Error('disk unavailable');
        return;
      }
      throw new Error(cmd);
    });
  });

  it('keeps edits after a rejected save and preserves arguments containing spaces', async () => {
    render(<McpSettings />);
    await screen.findByTestId('mcp-server-row-figma');
    fireEvent.click(screen.getByRole('button', { name: 'Edit figma' }));
    fireEvent.change(screen.getByLabelText('Startup arguments', { exact: false }), {
      target: { value: '-y\n/Users/me/My Tools/server.js\n' },
    });
    fireEvent.click(screen.getByTestId('mcp-edit-save'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes are kept');
    expect(screen.getByLabelText('Startup arguments', { exact: false })).toHaveValue(
      '-y\n/Users/me/My Tools/server.js\n',
    );
    expect(screen.getByTestId('mcp-server-row-figma')).toHaveTextContent('figma-developer-mcp');
    failSave = false;
    fireEvent.click(screen.getByTestId('mcp-edit-save'));
    await waitFor(() => expect(screen.queryByTestId('mcp-edit-form')).not.toBeInTheDocument());
    expect(transportMock).toHaveBeenLastCalledWith('mcp_config_set', {
      config: {
        mcpServers: expect.objectContaining({
          figma: expect.objectContaining({ args: ['-y', '/Users/me/My Tools/server.js'] }),
        }),
      },
    });
  });

  it('does not show a toggle as saved when persistence fails', async () => {
    render(<McpSettings />);
    const toggle = await screen.findByRole('switch', { name: 'Enable figma' });
    fireEvent.click(toggle);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(toggle).not.toBeChecked();
    failSave = false;
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('prevents duplicate names overwriting an existing connection', async () => {
    render(<McpSettings />);
    await screen.findByTestId('mcp-server-row-figma');
    fireEvent.click(screen.getByTestId('mcp-add'));
    fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'figma' } });
    fireEvent.change(screen.getByLabelText('Start command'), { target: { value: 'node' } });
    fireEvent.click(screen.getByTestId('mcp-edit-save'));
    expect(screen.getByRole('alert')).toHaveTextContent('already uses this name');
    expect(transportMock.mock.calls.some(([cmd]) => cmd === 'mcp_config_set')).toBe(false);
  });

  it('requires confirmation and keeps the connection when removal fails', async () => {
    render(<McpSettings />);
    await screen.findByTestId('mcp-server-row-figma');
    fireEvent.click(screen.getByRole('button', { name: 'Remove figma' }));
    expect(transportMock.mock.calls.some(([cmd]) => cmd === 'mcp_config_set')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes are kept');
    expect(screen.getByTestId('mcp-server-row-figma')).toBeInTheDocument();
    failSave = false;
    fireEvent.click(screen.getByRole('button', { name: 'Remove', exact: true }));
    await waitFor(() =>
      expect(screen.queryByTestId('mcp-server-row-figma')).not.toBeInTheDocument(),
    );
  });
});
