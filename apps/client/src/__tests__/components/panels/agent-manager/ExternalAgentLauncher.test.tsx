import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExternalAgentLauncher from '@/components/panels/agent-manager/ExternalAgentLauncher';
import {
  consumePendingAgentPrompt,
  requestAgentLaunch,
} from '@/components/panels/agent-manager/agent-launch-request';

const launchClaudeCode = vi.fn().mockResolvedValue({
  sessionId: 'cli-claude-1',
  label: 'Claude Code',
});

vi.mock('@/lib/transport', () => ({
  isTauri: () => false,
}));

vi.mock('@/components/panels/agent-manager/launch-cli-agent', () => ({
  launchClaudeCode: (...args: unknown[]) => launchClaudeCode(...args),
  launchCodex: vi.fn(),
  launchGeminiCli: vi.fn(),
  launchOpenCode: vi.fn(),
  launchCustomCli: vi.fn(),
}));

describe('ExternalAgentLauncher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    consumePendingAgentPrompt();
  });

  it('starts with an external agent and never offers Wisp Cloud', () => {
    render(<ExternalAgentLauncher currentPath="/tmp/wisp-project" />);

    expect(screen.getByRole('radio', { name: /Claude Code/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.queryByText(/Wisp Cloud/i)).not.toBeInTheDocument();
    expect(screen.getByText('/tmp/wisp-project')).toBeInTheDocument();
    expect(
      screen.getByText(/manages its own account, model, and permissions/i),
    ).toBeInTheDocument();
  });

  it('launches the selected CLI in the current folder', async () => {
    render(<ExternalAgentLauncher currentPath="/tmp/wisp-project" />);

    fireEvent.change(screen.getByLabelText('Task (optional)'), {
      target: { value: '检查这个项目' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));

    await waitFor(() => {
      expect(launchClaudeCode).toHaveBeenCalledWith('/tmp/wisp-project', '检查这个项目');
    });
  });

  it('prefills tasks forwarded from retired built-in AI actions', () => {
    requestAgentLaunch('解释当前代码');
    render(<ExternalAgentLauncher currentPath="/tmp/wisp-project" />);

    expect(screen.getByLabelText('Task (optional)')).toHaveValue('解释当前代码');
  });

  it('keeps custom CLI configuration in the Agent sidebar', () => {
    render(<ExternalAgentLauncher currentPath="/tmp/wisp-project" />);

    fireEvent.click(screen.getByRole('radio', { name: /Custom CLI/i }));
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'goose' } });

    expect(localStorage.getItem('wisp:agent-launcher-custom-command')).toBe('goose');
  });
});
