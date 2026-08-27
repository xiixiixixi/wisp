import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TauriAPI } from '@/lib/tauri-api';
import { clearExternalAgents } from '@/components/panels/agent-manager/external-agent-registry';
import { launchClaudeCode } from '@/components/panels/agent-manager/launch-cli-agent';

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    ptySpawn: vi.fn().mockResolvedValue(undefined),
    ptyWrite: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('launch-cli-agent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clearExternalAgents();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearExternalAgents();
  });

  it('passes prompt metacharacters to the shell as plain text', async () => {
    const launch = launchClaudeCode('/tmp/wisp-project', "review $(touch /tmp/nope) and it's safe");

    await vi.runAllTimersAsync();
    await launch;

    expect(TauriAPI.ptyWrite).toHaveBeenCalledWith(
      expect.any(String),
      "claude 'review $(touch /tmp/nope) and it'\"'\"'s safe'\n",
    );
  });
});
