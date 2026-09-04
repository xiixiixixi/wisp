import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CommandPalette from '@/components/CommandPalette';
import { TauriAPI } from '@/lib/tauri-api';

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
    isDir: vi.fn().mockResolvedValue(false),
  },
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const searchResult = (filename: string, path = `/search/${filename}`) => ({
  path,
  filename,
  matches: [],
  score: 1,
  relevance_type: 'exact',
});

describe('CommandPalette', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    vi.mocked(TauriAPI.getRecentFiles).mockResolvedValue([]);
    vi.mocked(TauriAPI.enhancedSearch).mockResolvedValue({ results: [] } as never);
    vi.mocked(TauriAPI.searchTokens).mockResolvedValue([]);
    vi.mocked(TauriAPI.findFiles).mockResolvedValue([]);
    vi.mocked(TauriAPI.isDir).mockResolvedValue(false);
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

  it('keeps stale query results and loading completions from replacing the latest search', async () => {
    const firstSearch = deferred<{ results: ReturnType<typeof searchResult>[] }>();
    const secondSearch = deferred<{ results: ReturnType<typeof searchResult>[] }>();
    vi.mocked(TauriAPI.enhancedSearch)
      .mockReturnValueOnce(firstSearch.promise as never)
      .mockReturnValueOnce(secondSearch.promise as never);

    render(<CommandPalette isOpen onClose={vi.fn()} currentPath="/Users/test/Documents" />);
    const input = screen.getByRole('combobox', { name: 'Search files and folders...' });

    fireEvent.change(input, { target: { value: 'first query' } });
    await waitFor(() =>
      expect(TauriAPI.enhancedSearch).toHaveBeenCalledWith('first query', undefined, 10),
    );

    fireEvent.change(input, { target: { value: 'latest query' } });
    await waitFor(() =>
      expect(TauriAPI.enhancedSearch).toHaveBeenCalledWith('latest query', undefined, 10),
    );

    await act(async () => {
      firstSearch.resolve({ results: [searchResult('stale-result.txt')] });
      await firstSearch.promise;
    });

    expect(screen.queryByText('stale-result.txt')).not.toBeInTheDocument();
    expect(screen.getByText('Searching files...')).toBeInTheDocument();

    await act(async () => {
      secondSearch.resolve({ results: [searchResult('latest-result.txt')] });
      await secondSearch.promise;
    });

    expect(await screen.findByText('latest-result.txt')).toBeInTheDocument();
    expect(screen.queryByText('Searching files...')).not.toBeInTheDocument();
  });

  it('invalidates an in-flight file search when switching to assistant mode', async () => {
    const fileSearch = deferred<{ results: ReturnType<typeof searchResult>[] }>();
    vi.mocked(TauriAPI.enhancedSearch).mockReturnValueOnce(fileSearch.promise as never);

    render(<CommandPalette isOpen onClose={vi.fn()} currentPath="/Users/test/Documents" />);
    const input = screen.getByRole('combobox', { name: 'Search files and folders...' });
    fireEvent.change(input, { target: { value: 'quarterly report' } });
    await waitFor(() => expect(TauriAPI.enhancedSearch).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('tab', { name: 'Ask Wisp' }));
    await act(async () => {
      fileSearch.resolve({ results: [searchResult('stale-report.pdf')] });
      await fileSearch.promise;
    });

    expect(screen.queryByText('stale-report.pdf')).not.toBeInTheDocument();
    expect(screen.queryByText('Searching files...')).not.toBeInTheDocument();
  });

  it('invalidates old-path fallbacks and classifies filesystem folders explicitly', async () => {
    const oldPathSearch = deferred<string[]>();
    vi.mocked(TauriAPI.findFiles)
      .mockReturnValueOnce(oldPathSearch.promise)
      .mockResolvedValueOnce(['/new/Folder.with.dot']);
    vi.mocked(TauriAPI.isDir).mockResolvedValue(true);
    const onFileSelect = vi.fn();
    const { rerender } = render(
      <CommandPalette isOpen onClose={vi.fn()} onFileSelect={onFileSelect} currentPath="/old" />,
    );
    const input = screen.getByRole('combobox', { name: 'Search files and folders...' });
    fireEvent.change(input, { target: { value: 'folder' } });
    await waitFor(() => expect(TauriAPI.findFiles).toHaveBeenCalledWith('folder', '/old'));

    rerender(
      <CommandPalette isOpen onClose={vi.fn()} onFileSelect={onFileSelect} currentPath="/new" />,
    );
    const newFolder = await screen.findByRole('option', { name: /Folder\.with\.dot/ });

    await act(async () => {
      oldPathSearch.resolve(['/old/Old.folder']);
      await oldPathSearch.promise;
    });
    expect(screen.queryByText('Old.folder')).not.toBeInTheDocument();

    fireEvent.click(newFolder);
    await waitFor(() => expect(onFileSelect).toHaveBeenCalledWith('/new/Folder.with.dot', true));
    expect(TauriAPI.isDir).toHaveBeenCalledWith('/new/Folder.with.dot');
  });

  it('keeps empty keyboard navigation in range and leaves Tab for normal focus movement', async () => {
    const onClose = vi.fn();
    const onFileSelect = vi.fn();
    render(
      <CommandPalette
        isOpen
        onClose={onClose}
        onFileSelect={onFileSelect}
        currentPath="/Users/test/Documents"
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Search files and folders...' });
    await waitFor(() => expect(input).toHaveFocus());

    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('aria-controls', 'command-palette-results');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(screen.getByRole('listbox', { name: 'Search results' })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    const backwardsTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(backwardsTab);

    expect(backwardsTab.defaultPrevented).toBe(false);
    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(onClose).not.toHaveBeenCalled();
    expect(onFileSelect).not.toHaveBeenCalled();
  });

  it('clamps an out-of-range selection when the result collection becomes empty', async () => {
    vi.mocked(TauriAPI.getRecentFiles).mockResolvedValue([
      {
        path: '/recent/first.txt',
        name: 'first.txt',
        accessed_at: 2,
        file_type: 'txt',
        size: 2,
      },
      {
        path: '/recent/second.txt',
        name: 'second.txt',
        accessed_at: 1,
        file_type: 'txt',
        size: 2,
      },
    ]);
    const onClose = vi.fn();
    const onFileSelect = vi.fn();
    render(
      <CommandPalette
        isOpen
        onClose={onClose}
        onFileSelect={onFileSelect}
        currentPath="/Users/test/Documents"
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Search files and folders...' });
    await screen.findByRole('option', { name: /second\.txt/ });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'command-palette-option-1');

    fireEvent.change(input, { target: { value: 'x' } });
    await waitFor(() => expect(input).not.toHaveAttribute('aria-activedescendant'));
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onClose).not.toHaveBeenCalled();
    expect(onFileSelect).not.toHaveBeenCalled();
  });

  it('restores focus to the command palette trigger when the overlay unmounts', async () => {
    const previous = document.createElement('button');
    const trigger = document.createElement('button');
    trigger.dataset.commandPaletteTrigger = '';
    document.body.append(previous, trigger);
    previous.focus();

    const { unmount } = render(
      <CommandPalette isOpen onClose={vi.fn()} currentPath="/Users/test/Documents" />,
    );
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Search files and folders...' })).toHaveFocus(),
    );

    unmount();
    await waitFor(() => expect(trigger).toHaveFocus());
    previous.remove();
    trigger.remove();
  });

  it('uses recent-file metadata for dotted folders and extensionless files', async () => {
    vi.mocked(TauriAPI.getRecentFiles).mockResolvedValue([
      {
        path: '/recent/Archive.2026',
        name: 'Archive.2026',
        accessed_at: 1,
        file_type: 'folder',
        size: 0,
      },
      {
        path: '/recent/LICENSE',
        name: 'LICENSE',
        accessed_at: 1,
        file_type: '',
        size: 128,
      },
    ]);
    const onFileSelect = vi.fn();
    render(
      <CommandPalette
        isOpen
        onClose={vi.fn()}
        onFileSelect={onFileSelect}
        currentPath="/Users/test/Documents"
      />,
    );

    fireEvent.click(await screen.findByRole('option', { name: /Archive\.2026/ }));
    await waitFor(() => expect(onFileSelect).toHaveBeenCalledWith('/recent/Archive.2026', true));

    fireEvent.click(screen.getByRole('option', { name: /LICENSE/ }));
    await waitFor(() => expect(onFileSelect).toHaveBeenCalledWith('/recent/LICENSE', false));
  });
});
