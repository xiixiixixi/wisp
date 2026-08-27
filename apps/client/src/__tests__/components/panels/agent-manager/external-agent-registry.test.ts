import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearExternalAgents,
  getExternalAgentsSnapshot,
  markExternalAgentExited,
  subscribeToExternalAgents,
  upsertExternalAgent,
} from '@/components/panels/agent-manager/external-agent-registry';

describe('external agent registry', () => {
  beforeEach(() => clearExternalAgents());

  it('keeps the exact terminal session and working directory outside the panel lifecycle', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToExternalAgents(listener);
    const now = Date.now();

    upsertExternalAgent({
      id: 'ext-cli-codex-1',
      type: 'codex',
      displayName: 'Codex',
      terminalSessionId: 'cli-codex-1',
      terminalLabel: 'Codex',
      workingDirectory: '/tmp/wisp-project',
      status: 'active',
      detectedAt: now,
      lastActivityAt: now,
      filesChanged: [],
    });

    expect(getExternalAgentsSnapshot()).toEqual([
      expect.objectContaining({
        terminalSessionId: 'cli-codex-1',
        workingDirectory: '/tmp/wisp-project',
        status: 'active',
      }),
    ]);
    expect(listener).toHaveBeenCalledTimes(1);

    markExternalAgentExited('cli-codex-1');
    expect(getExternalAgentsSnapshot()[0].status).toBe('exited');
    unsubscribe();
  });
});
