import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CommandPalette from '@/components/CommandPalette';

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

describe('CommandPalette', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  // The commands mode was removed: the palette is file search + Ask Wisp only.
  it('offers only Files and Ask Wisp modes', async () => {
    render(<CommandPalette isOpen onClose={vi.fn()} currentPath="/Users/test/Documents" />);

    expect(screen.getByRole('tab', { name: 'Files' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Ask Wisp' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Commands' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Search files and folders...')).toHaveFocus(),
    );
  });

  it('offers a go-to-folder action for path-like queries', async () => {
    const onFileSelect = vi.fn();
    render(
      <CommandPalette
        isOpen
        onClose={vi.fn()}
        onFileSelect={onFileSelect}
        currentPath="/Users/test/Documents"
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Search files and folders...'), {
      target: { value: '/Users/test/Downloads' },
    });

    const goTo = await screen.findByRole('option', { name: /Go to folder/ });
    fireEvent.click(goTo);
    await waitFor(() => expect(onFileSelect).toHaveBeenCalledWith('/Users/test/Downloads', true));
  });

  it('sends an assistant request with the prompt and current folder context', async () => {
    const onClose = vi.fn();
    const listener = vi.fn();
    window.addEventListener('wisp-ai-chat-request', listener);

    render(<CommandPalette isOpen onClose={onClose} currentPath="/Users/test/Documents" />);
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
