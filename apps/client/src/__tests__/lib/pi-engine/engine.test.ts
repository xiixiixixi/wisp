/**
 * pi-engine integration tests — faux-driven, no network.
 * Verifies the approval gate end-to-end: denied calls never reach Rust,
 * allowed ones cross with approved=true, and read-only tools run freely.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/transport', () => ({
  isTauri: vi.fn(() => false),
  transport: vi.fn(async (..._args: unknown[]) => {
    throw new Error('transport must not be called in this test');
  }),
}));

import { createFauxCore, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { PiEngine, type ApprovalDecision } from '@/lib/pi-engine/engine';
import { requiresApproval, WRITE_TOOLS } from '@/lib/pi-engine/tools';
import { transport, isTauri } from '@/lib/transport';
import { invalidateMem0State } from '@/lib/pi-engine/mem0';

const makeFaux = () => {
  const faux = createFauxCore({ api: 'faux-test', provider: 'faux', models: [{ id: 'faux-1' }] });
  return faux;
};

const callbacks = (decision: ApprovalDecision) => {
  const deltas: string[] = [];
  const approvals: string[] = [];
  return {
    deltas,
    approvals,
    cb: {
      onTextDelta: (t: string) => deltas.push(t),
      onThinkingDelta: () => undefined,
      onApprovalRequest: async (req: { name: string }) => {
        approvals.push(req.name);
        return decision;
      },
      onComplete: () => undefined,
      onError: () => undefined,
    },
  };
};

describe('pi-engine approval gate', () => {
  beforeEach(() => {
    vi.mocked(transport).mockClear();
  });

  it('read-only tools execute without any approval prompt', async () => {
    const faux = makeFaux();
    faux.setResponses([
      { content: [fauxText('看看。'), fauxToolCall('list_directory', { path: '/tmp' })] },
      { content: [fauxText('完成。')] },
    ]);
    const { cb, approvals } = callbacks('deny');
    const engine = await PiEngine.start({
      anchor: '/tmp/x',
      model: 'ollama:faux-test',
      callbacks: cb,
      persist: false,
      streamFnOverride: faux.streamSimple.bind(faux) as never,
    });
    await engine.prompt('列一下');

    expect(approvals).toEqual([]);
    expect(transport).toHaveBeenCalledWith('agent_execute_tool', expect.objectContaining({
      toolName: 'list_directory',
      approved: true, // read-only: backend does not gate it
    }));
  });

  it('autoApprove all (full access) runs write tools without any approval prompt', async () => {
    const faux = makeFaux();
    faux.setResponses([
      { content: [fauxToolCall('delete', { path: '/tmp/x/a.txt' })] },
      { content: [fauxText('已删除。')] },
    ]);
    const { cb, approvals } = callbacks('deny'); // 即便回调说 deny，full access 也不问
    const engine = await PiEngine.start({
      anchor: '/tmp/x',
      model: 'ollama:faux-test',
      callbacks: cb,
      persist: false,
      autoApprove: 'all',
      streamFnOverride: faux.streamSimple.bind(faux) as never,
    });
    await engine.prompt('删掉它');

    expect(approvals).toEqual([]);
    expect(transport).toHaveBeenCalledWith('agent_execute_tool', expect.objectContaining({
      toolName: 'delete',
      approved: true,
    }));

    // 运行时切回 ask：下一次写工具恢复审批
    engine.setAutoApprove(new Set());
    faux.setResponses([
      { content: [fauxToolCall('delete', { path: '/tmp/x/b.txt' })] },
      { content: [fauxText('好的。')] },
    ]);
    await engine.prompt('再删一个');
    expect(approvals).toEqual(['delete']);
  });

  it('denied write tool never reaches Rust and the model sees the refusal', async () => {
    const faux = makeFaux();
    faux.setResponses([
      { content: [fauxToolCall('delete', { path: '/tmp/x/a.txt' })] },
      { content: [fauxText('好的，已取消。')] },
    ]);
    const { cb, approvals } = callbacks('deny');
    const engine = await PiEngine.start({
      anchor: '/tmp/x',
      model: 'ollama:faux-test',
      callbacks: cb,
      persist: false,
      streamFnOverride: faux.streamSimple.bind(faux) as never,
    });
    await engine.prompt('删掉它');

    expect(approvals).toEqual(['delete']);
    expect(transport).not.toHaveBeenCalled();
  });

  it('allowed write tool crosses to Rust with approved=true', async () => {
    const faux = makeFaux();
    faux.setResponses([
      { content: [fauxToolCall('delete', { path: '/tmp/x/a.txt' })] },
      { content: [fauxText('已删除。')] },
    ]);
    const { cb, approvals, deltas } = callbacks('allow_once');
    const engine = await PiEngine.start({
      anchor: '/tmp/x',
      model: 'ollama:faux-test',
      callbacks: cb,
      persist: false,
      streamFnOverride: faux.streamSimple.bind(faux) as never,
    });
    await engine.prompt('删掉它');

    expect(approvals).toEqual(['delete']);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith('agent_execute_tool', expect.objectContaining({
      toolName: 'delete',
      approved: true,
    }));
    expect(deltas.join('')).toContain('已删除');
  });

  it('auto-approve set skips the approval UI for listed tools', async () => {
    const faux = makeFaux();
    faux.setResponses([
      { content: [fauxToolCall('rename', { old_path: '/tmp/a', new_path: '/tmp/b' })] },
      { content: [fauxText('done')] },
    ]);
    const { cb, approvals } = callbacks('deny'); // would deny — must never be asked
    const engine = await PiEngine.start({
      anchor: '/tmp/x',
      model: 'ollama:faux-test',
      callbacks: cb,
      persist: false,
      autoApprove: new Set(['rename']),
      streamFnOverride: faux.streamSimple.bind(faux) as never,
    });
    await engine.prompt('改名');

    expect(approvals).toEqual([]);
    expect(transport).toHaveBeenCalledWith('agent_execute_tool', expect.objectContaining({
      toolName: 'rename',
      approved: true,
    }));
  });
});

describe('pi-engine helpers', () => {
  it('requiresApproval matches the Rust write-tool set', () => {
    const expected = [
      'write_file', 'create_directory', 'rename', 'delete', 'move_file',
      'copy_file', 'execute_command', 'execute_plan', 'create_plan',
    ];
    expect([...WRITE_TOOLS].sort()).toEqual([...expected].sort());
    expect(requiresApproval('read_file')).toBe(false);
    expect(requiresApproval('delete')).toBe(true);
  });

  it('normalizeMessage tags role and strips diagnostics', () => {
    const normalized = PiEngine.normalizeMessage({
      content: [{ type: 'text', text: 'hi' }],
      diagnostics: [{ code: 'x' }],
      timestamp: 1,
    });
    expect(normalized?.role).toBe('assistant');
    expect(normalized?.diagnostics).toBeUndefined();

    expect(PiEngine.normalizeMessage(null)).toBeNull();
  });

  it('buildSystemPrompt includes the anchor', async () => {
    const prompt = await PiEngine.buildSystemPrompt('/Users/x/Downloads');
    expect(prompt).toContain('/Users/x/Downloads');
  });
});

describe('pi-engine mem0 auto memory hooks', () => {
  beforeEach(() => {
    vi.mocked(transport).mockClear();
    invalidateMem0State();
    vi.mocked(isTauri).mockReturnValue(true);
  });

  afterEach(() => {
    vi.mocked(isTauri).mockReturnValue(false);
  });

  const mem0Faux = async () => {
    const faux = makeFaux();
    faux.setResponses([{ content: [fauxText('好的，记住了。')] }]);
    const { cb } = callbacks('deny');
    const engine = await PiEngine.start({
      anchor: '/tmp/x',
      model: 'ollama:faux-test',
      callbacks: cb,
      persist: false,
      streamFnOverride: faux.streamSimple.bind(faux) as never,
    });
    return engine;
  };

  it('captures the round to mem0 after completion and injects recalled memories before the next turn', async () => {
    vi.mocked(transport).mockImplementation(async (cmd: string, _args?: Record<string, unknown>) => {
      if (cmd === 'mem0_config_state') {
        return { enabled: true, has_key: true, user_id: 'wisp', auto_capture: true };
      }
      if (cmd === 'mem0_search') {
        return [
          { id: 'm1', memory: 'User likes date-prefixed filenames', score: 0.4, categories: ['user_preferences'] },
        ];
      }
      if (cmd === 'mem0_add') {
        return null;
      }
      if (cmd === 'pi_config_state') {
        return { models_json: { providers: {} }, auth_status: [] };
      }
      return null;
    });
    const engine = await mem0Faux();
    const before = engine.agent.state.systemPrompt;
    await engine.prompt('记住：我文件都用日期开头命名');

    // 自动召回注入了云记忆
    expect(engine.agent.state.systemPrompt).toContain('date-prefixed filenames');
    expect(engine.agent.state.systemPrompt.startsWith(before.slice(0, 20))).toBe(true);
    // 自动记录：本轮 user+assistant 文本都送去了 mem0
    expect(transport).toHaveBeenCalledWith('mem0_add', {
      userText: '记住：我文件都用日期开头命名',
      assistantText: '好的，记住了。',
    });
  });

  it('skips cloud recall entirely when mem0 is disabled', async () => {
    vi.mocked(transport).mockImplementation(async (cmd: string) => {
      if (cmd === 'mem0_config_state') {
        return { enabled: false, has_key: false, user_id: 'wisp', auto_capture: false };
      }
      throw new Error(`unexpected transport call: ${cmd}`);
    });
    const engine = await mem0Faux();
    await engine.prompt('普通问题');
    const calls = vi.mocked(transport).mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('mem0_search');
    expect(calls).not.toContain('mem0_add');
  });
});
