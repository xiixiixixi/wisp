import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CommandPalette, { type Command } from '@/components/CommandPalette';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    estimateSize,
  }: {
    count: number;
    estimateSize: (index: number) => number;
  }) => {
    const rows = Array.from({ length: count }, (_, index) => ({
      index,
      key: index,
      start: Array.from({ length: index }, (__, previous) => estimateSize(previous)).reduce(
        (sum, size) => sum + size,
        0,
      ),
    }));
    return {
      getTotalSize: () => rows.reduce((sum, row) => sum + estimateSize(row.index), 0),
      getVirtualItems: () => rows,
      scrollToIndex: vi.fn(),
    };
  },
}));

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    getRecentFiles: vi.fn().mockResolvedValue([]),
    enhancedSearch: vi.fn().mockResolvedValue({ results: [] }),
    searchTokens: vi.fn().mockResolvedValue([]),
    findFiles: vi.fn().mockResolvedValue([]),
  },
}));

const commands: Command[] = [
  { id: 'new-folder', title: 'New folder', action: vi.fn() },
  { id: 'home', title: 'Go home', action: vi.fn() },
  { id: 'toggle-preview', title: 'Toggle preview', action: vi.fn() },
  { id: 'toggle-terminal', title: 'Toggle terminal', action: vi.fn() },
  { id: 'settings', title: 'Open settings', action: vi.fn() },
  { id: 'keyboard-shortcuts', title: 'Keyboard shortcuts', action: vi.fn() },
  { id: 'extra-command', title: 'Extra command', action: vi.fn() },
];

describe('CommandPalette', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('opens with a calm set of quick actions and exposes the full command catalogue by mode', async () => {
    render(
      <CommandPalette
        isOpen
        onClose={vi.fn()}
        commands={commands}
        currentPath="/Users/test/Documents"
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Wisp Command Center' })).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /New folder/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Extra command/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Commands' }));

    expect(screen.getByRole('option', { name: /Extra command/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Search every Wisp command...')).toHaveFocus(),
    );
  });

  it('sends an assistant request with the prompt and current folder context', async () => {
    const onClose = vi.fn();
    const listener = vi.fn();
    window.addEventListener('wisp-ai-chat-request', listener);

    render(
      <CommandPalette
        isOpen
        onClose={onClose}
        commands={commands}
        currentPath="/Users/test/Documents"
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Ask Wisp' }));
    const input = screen.getByPlaceholderText('Ask Wisp about your files...');
    fireEvent.change(input, { target: { value: 'Summarize the PDFs in this folder' } });

    const assistantAction = await screen.findByRole('option', {
      name: /Ask Wisp: Summarize the PDFs in this folder/,
    });
    fireEvent.click(assistantAction);

    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(listener).toHaveBeenCalledOnce());
    const event = listener.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({
      prompt: 'Summarize the PDFs in this folder',
      currentPath: '/Users/test/Documents',
    });

    window.removeEventListener('wisp-ai-chat-request', listener);
  });
});
