import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AgentManagerPanel from '@/components/panels/AgentManagerPanel';

vi.mock('@/components/panels/agent-manager/ExternalAgentLauncher', () => ({
  default: ({ currentPath }: { currentPath: string }) => (
    <div data-testid="external-agent-launcher">{currentPath}</div>
  ),
}));

vi.mock('@/components/panels/agent-manager/TerminalAgentDetector', () => ({
  default: () => <div data-testid="terminal-agent-detector" />,
}));

vi.mock('@/components/panels/agent-manager/ProjectMemorySection', () => ({
  default: ({ currentPath }: { currentPath: string }) => (
    <div data-testid="project-memory">{currentPath}</div>
  ),
}));

describe('AgentManagerPanel', () => {
  it('contains only the external launcher, running terminals and project history', () => {
    render(<AgentManagerPanel currentPath="/tmp/wisp-project" />);

    expect(screen.getByTestId('external-agent-launcher')).toHaveTextContent('/tmp/wisp-project');
    expect(screen.getByTestId('terminal-agent-detector')).toBeInTheDocument();
    expect(screen.getByTestId('project-memory')).toHaveTextContent('/tmp/wisp-project');

    expect(screen.queryByText('任务队列')).not.toBeInTheDocument();
    expect(screen.queryByText('模板')).not.toBeInTheDocument();
    expect(screen.queryByText('费用与用量')).not.toBeInTheDocument();
  });
});
