/**
 * MCP 客户端桥 —— 工具命名与审批门。
 */
import { describe, it, expect, vi } from 'vitest';
import { loadMcpTools, mcpToolName } from '@/lib/pi-engine/mcp';
import { requiresApproval } from '@/lib/pi-engine/tools';

vi.mock('@/lib/transport', () => ({
  isTauri: () => false,
  transport: vi.fn(),
}));

describe('mcpToolName', () => {
  it('mangles server and tool into a stable prefixed name', () => {
    expect(mcpToolName('web-reader', 'read_page')).toBe('mcp__web-reader__read_page');
  });
});

describe('requiresApproval', () => {
  it('always gates external MCP tools, unlike built-in read tools', () => {
    expect(requiresApproval('mcp__web-reader__read_page')).toBe(true);
    expect(requiresApproval('mcp__anything__else')).toBe(true);
    expect(requiresApproval('read_file')).toBe(false);
    expect(requiresApproval('write_file')).toBe(true);
  });
});

describe('loadMcpTools', () => {
  it('degrades to an empty list outside Tauri', async () => {
    await expect(loadMcpTools()).resolves.toEqual([]);
  });
});
