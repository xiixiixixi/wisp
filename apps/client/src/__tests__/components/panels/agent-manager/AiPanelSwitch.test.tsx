import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AiPanelSwitch from '@/components/panels/agent-manager/AiPanelSwitch';

describe('AiPanelSwitch', () => {
  const labels = { chat: 'AI 对话', tasks: 'AI 任务' };
  const onChange = vi.fn();

  it('renders both sub-panel tabs with provided labels', () => {
    render(<AiPanelSwitch active="chat" onChange={onChange} labels={labels} />);
    expect(screen.getByTestId('ai-tab-chat')).toHaveTextContent('AI 对话');
    expect(screen.getByTestId('ai-tab-agent-manager')).toHaveTextContent('AI 任务');
  });

  it('marks the active tab as pressed', () => {
    render(<AiPanelSwitch active="agent-manager" onChange={onChange} labels={labels} />);
    expect(screen.getByTestId('ai-tab-agent-manager')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('ai-tab-chat')).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches tab on click and reports the target id', () => {
    onChange.mockClear();
    render(<AiPanelSwitch active="chat" onChange={onChange} labels={labels} />);
    fireEvent.click(screen.getByTestId('ai-tab-agent-manager'));
    expect(onChange).toHaveBeenCalledWith('agent-manager');
  });

  it('does not re-fire for the already active tab', () => {
    onChange.mockClear();
    render(<AiPanelSwitch active="chat" onChange={onChange} labels={labels} />);
    fireEvent.click(screen.getByTestId('ai-tab-chat'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
