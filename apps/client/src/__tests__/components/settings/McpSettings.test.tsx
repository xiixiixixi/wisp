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
    expect(screen.getByText(/http · https:\/\/e\/mcp/)).toBeInTheDocument();
    expect(screen.getByText(/stdio · npx -y figma-developer-mcp/)).toBeInTheDocument();
    // figma 禁用 → 开关 off
    const toggles = screen.getAllByRole('switch');
    expect(toggles[1]).toHaveAttribute('aria-checked', 'false');
  });

  it('toggling a server persists the flipped config', async () => {
    render(<McpSettings />);
    await screen.findByTestId('mcp-server-row-figma');
    fireEvent.click(screen.getAllByRole('switch')[1]);
    await waitFor(() => expect(transportMock).toHaveBeenCalledWith('mcp_config_set', {
      config: {
        mcpServers: expect.objectContaining({
          figma: expect.objectContaining({ enabled: true }),
        }),
      },
    }));
  });

  it('adding an http server validates URL then saves', async () => {
    render(<McpSettings />);
    await screen.findByTestId('mcp-server-row-web-reader');
    fireEvent.click(screen.getByTestId('mcp-add'));
    fireEvent.change(screen.getByTestId('mcp-edit-name'), { target: { value: 'search' } });
    // 先选 http 但不填 URL → 提示
    fireEvent.click(screen.getByRole('button', { name: 'http' }));
    fireEvent.click(screen.getByTestId('mcp-edit-save'));
    await waitFor(() => expect(transportMock.mock.calls.some((c) => c[0] === 'mcp_config_set')).toBe(false)); // 未触发保存

    fireEvent.change(screen.getByLabelText('url'), { target: { value: 'https://s/mcp' } });
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
    const results = await screen.findAllByTestId('mcp-test-result-web-reader');
    expect(results[results.length - 1]).toHaveTextContent(/3/);
  });
});
