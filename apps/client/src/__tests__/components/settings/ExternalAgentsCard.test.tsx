import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExternalAgentsCard from '@/components/settings/ExternalAgentsCard';

const baseProps = {
  title: '外部 Agent（推荐）',
  description: '零配置说明',
  copiedLabel: '已复制',
  copyLabel: '复制安装命令',
  agents: [
    { command: 'claude', label: 'Claude Code', installed: true },
    {
      command: 'codex',
      label: 'Codex CLI',
      installed: false,
      installCmd: 'npm i -g @openai/codex',
    },
    { command: 'gemini', label: 'Gemini CLI' },
  ],
};

describe('ExternalAgentsCard', () => {
  it('renders every agent row', () => {
    render(<ExternalAgentsCard {...baseProps} />);
    expect(screen.getByTestId('external-agent-claude')).toHaveTextContent('Claude Code');
    expect(screen.getByTestId('external-agent-codex')).toHaveTextContent('Codex CLI');
    expect(screen.getByTestId('external-agent-gemini')).toHaveTextContent('Gemini CLI');
  });

  it('shows the copy-install button only for missing agents', () => {
    render(<ExternalAgentsCard {...baseProps} />);
    expect(screen.getByTestId('external-agent-codex').querySelector('button')).not.toBeNull();
    expect(screen.getByTestId('external-agent-claude').querySelector('button')).toBeNull();
    // unknown detection state (web demo): no button either
    expect(screen.getByTestId('external-agent-gemini').querySelector('button')).toBeNull();
  });

  it('reports the install command on copy click', () => {
    const onCopy = vi.fn();
    render(<ExternalAgentsCard {...baseProps} onCopy={onCopy} />);
    fireEvent.click(
      screen.getByTestId('external-agent-codex').querySelector('button') as HTMLElement,
    );
    expect(onCopy).toHaveBeenCalledWith('npm i -g @openai/codex');
  });

  it('shows the copied state for the command that was just copied', () => {
    render(<ExternalAgentsCard {...baseProps} copiedCommand="npm i -g @openai/codex" />);
    expect(screen.getByTestId('external-agent-codex').querySelector('button')).toHaveTextContent(
      '已复制',
    );
  });
});
