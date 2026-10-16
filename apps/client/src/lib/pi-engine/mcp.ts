/**
 * MCP 客户端桥 —— 把外部 MCP 服务器（~/.pi/agent/mcp.json）的工具
 * 变成 pi 引擎可用的 AgentTool。
 *
 * 命名 mcp__<服务器>__<工具>；所有 MCP 工具默认走审批门（外部工具
 * 可能写外部系统，宁可多问一句）。启动拉取工具有整体超时与静默降级，
 * 服务器失联不阻塞对话。
 */
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { transport, isTauri } from '@/lib/transport';

export interface McpToolDefDto {
  server: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const mcpToolName = (server: string, tool: string) => `mcp__${server}__${tool}`;

/** 拉全部已配置服务器的工具清单（服务器拉起失败会被 Rust 侧跳过）。 */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
export const loadMcpTools = async (): Promise<AgentTool<any>[]> => {
  if (!isTauri()) return [];
  const tools = await transport<McpToolDefDto[]>('mcp_client_list_tools');
  return tools.map((t) => ({
    name: mcpToolName(t.server, t.name),
    label: `${t.server}/${t.name}`,
    description: `[MCP · ${t.server}] ${t.description || t.name}`,
    parameters: (t.inputSchema ?? { type: 'object', properties: {} }) as never,
    // MCP 工具可能写外部系统：串行 + 走审批
    executionMode: 'sequential',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (_toolCallId: string, params: any) => {
      const result = await transport<{
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      }>('mcp_client_call_tool', {
        server: t.server,
        tool: t.name,
        arguments: params ?? {},
      });
      const text = (result.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n');
      if (result.isError) {
        throw new Error(text || `MCP tool ${t.server}/${t.name} failed`);
      }
      return {
        content: [{ type: 'text' as const, text: text || JSON.stringify(result) }],
        details: { name: mcpToolName(t.server, t.name), status: 'completed' },
      };
    },
  }));
};
