/**
 * pi-engine tool bridge.
 *
 * The 17 Wisp tools, defined as pi AgentTools whose execute() crosses into
 * Rust via the unified `agent_execute_tool` command. Approval is enforced
 * twice: the engine's beforeToolCall gate admits a call into `approvedCalls`,
 * and only admitted calls pass approved=true to the backend, whose own
 * backstay rejects write tools without it. Path sandboxing happens in Rust.
 */
import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { transport } from '@/lib/transport';
import { dispatchLocalFilesChanged } from '@/lib/file-change-events';

export interface ToolCallOutcome {
  id: string;
  name: string;
  status: 'completed' | 'error' | 'denied';
  result?: string;
  error?: string;
}

/** Names requiring approval — mirrored from agent/tools.rs. */
export const WRITE_TOOLS = new Set([
  'write_file',
  'create_directory',
  'rename',
  'delete',
  'move_file',
  'copy_file',
  'execute_command',
  'execute_plan',
  'create_plan',
]);

export const requiresApproval = (name: string): boolean =>
  WRITE_TOOLS.has(name) ||
  // 外部 MCP 工具一律审批（可能写外部系统），「完全访问」或 allow_always 可放行
  name.startsWith('mcp__');

/** 文件被谁改了（含路径）——预览面板靠它决定要不要重载内容。 */
export const FILE_WRITTEN_EVENT = 'wisp-file-written';

const announceWrite = (name: string, input: Record<string, unknown>) => {
  dispatchLocalFilesChanged();
  const raw = [input.path, input.target].find((v) => typeof v === 'string');
  const path = typeof raw === 'string' ? raw : undefined;
  if (path) {
    window.dispatchEvent(new CustomEvent(FILE_WRITTEN_EVENT, { detail: { path, tool: name } }));
  }
};

export interface ToolContext {
  /** Session id for backend event routing (tool cards in the UI). */
  sessionId: string;
  anchor: string | null;
  /** Whether the approval gate admitted this specific tool call. */
  isApproved: (toolCallId: string) => boolean;
}

export const makeToolContext = (): ToolContext & { admit: (id: string) => void } => {
  const approvedCalls = new Set<string>();
  return {
    sessionId: 'unbound',
    anchor: null,
    isApproved: (id) => approvedCalls.has(id),
    admit: (id) => approvedCalls.add(id),
  };
};

const callRust = async (
  ctx: ToolContext,
  name: string,
  toolCallId: string,
  input: Record<string, unknown>,
): Promise<ToolCallOutcome> => {
  const approved = !requiresApproval(name) || ctx.isApproved(toolCallId);
  try {
    return await transport<ToolCallOutcome>('agent_execute_tool', {
      sessionId: ctx.sessionId,
      toolName: name,
      toolInput: input,
      approved,
    });
  } catch (e) {
    return { id: toolCallId, name, status: 'error', error: String(e) };
  }
};

export const makeTool = (
  ctx: ToolContext,
  name: string,
  description: string,
  // pi 的 AgentTool 参数是运行时 JSON schema，这里保持宽类型经断言收敛
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform?: (params: any) => Record<string, unknown>,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
): AgentTool<any> => ({
  name,
  label: name,
  description,
  parameters: schema,
  // Write tools must not run concurrently with each other.
  executionMode: requiresApproval(name) ? 'sequential' : 'parallel',
  execute: async (toolCallId: string, params: unknown) => {
    // 工具参数透传给 Rust，形状由各工具 schema 约束
    const p = params as Record<string, unknown>;
    const input = transform ? transform(p) : p;
    const outcome = await callRust(ctx, name, toolCallId, input);
    if (outcome.status === 'error') {
      throw new Error(outcome.error ?? `${name} failed`);
    }
    // 写盘成功后广播：文件列表刷新 + 带 path 的写入事件让预览重载内容
    // （画布文档列就靠这条看见 AI 的修改）。
    if (WRITE_TOOLS.has(name)) {
      try {
        announceWrite(name, input);
      } catch {
        // 刷新广播失败不影响工具结果
      }
    }
    return {
      content: [{ type: 'text' as const, text: outcome.result ?? '' }],
      details: { name, status: outcome.status },
    };
  },
});

/**
 * Local (no Rust round-trip) `skill` tool: the model passes a name from the
 * <available_skills> block and gets the full SKILL.md instructions back.
 */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
export const makeSkillTool = (lookup: (name: string) => Promise<string>): AgentTool<any> => ({
  name: 'skill',
  label: 'skill',
  description:
    "Load an agent skill's full instructions. Call with the exact skill name from the available-skills block, then follow the returned instructions.",
  parameters: Type.Object({
    name: Type.String({ description: 'Exact skill name, e.g. "design-taste-frontend"' }),
  }),
  executionMode: 'parallel',
  execute: async (_toolCallId: string, params: unknown) => {
    const text = await lookup(String((params as { name?: string })?.name ?? ''));
    return {
      content: [{ type: 'text' as const, text }],
      details: { name: 'skill', status: 'completed' },
    };
  },
});

/** All Wisp tools bound to a session context. */
// AgentTool<any> 是 pi-agent-core 的公开宽类型；此处保持与库一致的签名。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const buildPiTools = (ctx: ToolContext, skillLookup?: (name: string) => Promise<string>): AgentTool<any>[] => [
  makeTool(ctx, 'read_file',
    'Read the contents of a file at the given path. Returns the text content.',
    Type.Object({ path: Type.String({ description: 'Absolute path of the file' }) })),
  makeTool(ctx, 'list_directory',
    'List all files and directories in a given path. Returns JSON array of entries with name, is_dir, size.',
    Type.Object({ path: Type.String({ description: 'Absolute path of the directory' }) })),
  makeTool(ctx, 'search_files',
    'Search for files matching a glob pattern (e.g. "**/*.txt") within a directory.',
    Type.Object({
      pattern: Type.String({ description: 'Glob pattern to match' }),
      path: Type.String({ description: 'Base directory to search in' }),
    })),
  makeTool(ctx, 'search_content',
    'Search file contents for a regex pattern within a directory. Returns matching lines.',
    Type.Object({
      pattern: Type.String({ description: 'Regex pattern to search for' }),
      path: Type.String({ description: 'Directory to search in' }),
    })),
  makeTool(ctx, 'get_system_info',
    'Get system information: OS, architecture, hostname, current time.',
    Type.Object({})),
  makeTool(ctx, 'write_file',
    'Write content to a file. Creates the file if it does not exist, overwrites if it does. Requires user approval.',
    Type.Object({
      path: Type.String({ description: 'Absolute path to write to' }),
      content: Type.String({ description: 'Content to write' }),
    })),
  makeTool(ctx, 'create_directory',
    'Create a directory (and any missing parent directories). Requires user approval.',
    Type.Object({ path: Type.String({ description: 'Absolute path of the directory' }) })),
  makeTool(ctx, 'rename',
    'Rename a file or directory. Requires user approval.',
    Type.Object({
      old_path: Type.String({ description: 'Current path' }),
      new_path: Type.String({ description: 'New path' }),
    })),
  makeTool(ctx, 'delete',
    'Move a file or directory to the system trash. Requires user approval.',
    Type.Object({ path: Type.String({ description: 'Absolute path to delete (moved to trash)' }) })),
  makeTool(ctx, 'move_file',
    'Move a file or directory to a new location. Requires user approval.',
    Type.Object({
      source: Type.String({ description: 'Source path' }),
      destination: Type.String({ description: 'Destination path' }),
    })),
  makeTool(ctx, 'copy_file',
    'Copy a file or directory to a new location. Requires user approval.',
    Type.Object({
      source: Type.String({ description: 'Source path' }),
      destination: Type.String({ description: 'Destination path' }),
    })),
  makeTool(ctx, 'execute_command',
    'Execute a shell command. Requires user approval.',
    Type.Object({
      command: Type.String({ description: 'The shell command to execute' }),
      working_dir: Type.Optional(Type.String({ description: 'Working directory' })),
    })),
  makeTool(ctx, 'extract_document_text',
    'Extract text from PDF/DOC/DOCX/XLS/XLSX/PPT/PPTX/RTF files.',
    Type.Object({ path: Type.String({ description: 'Absolute path of the document' }) })),
  makeTool(ctx, 'create_plan',
    'Create an operation plan for complex multi-step tasks (3+ steps or destructive). Returns a plan ID shown to the user for approval.',
    Type.Object({
      title: Type.String({ description: "Short title, e.g. 'Organize Downloads folder'" }),
      description: Type.Optional(Type.String({ description: 'Brief goal description' })),
      steps: Type.Array(
        Type.Object({
          action: Type.String({ description: "Action to perform, e.g. 'move_file'" }),
          description: Type.String({ description: 'Human-readable step description' }),
          params: Type.Object({}, { additionalProperties: true }),
        }),
        { description: 'Ordered list of steps' },
      ),
    })),
  makeTool(ctx, 'execute_plan',
    'Execute an approved plan by its ID. The plan must be in approved state.',
    Type.Object({ plan_id: Type.String({ description: 'Plan ID returned by create_plan' }) })),
  ...(skillLookup ? [makeSkillTool(skillLookup)] : []),
];
