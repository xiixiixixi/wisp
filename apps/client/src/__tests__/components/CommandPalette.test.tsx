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
      measureElement: vi.fn(),
    };
  },
}));

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    getRecentFiles: vi.fn().mockResolvedValue([]),
    findFiles: vi.fn().mockResolvedValue([]),
    listDrives: vi.fn(),
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

describe('CommandPalette', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    vi.mocked(TauriAPI.getRecentFiles).mockResolvedValue([]);
    vi.mocked(TauriAPI.findFiles).mockResolvedValue([]);
    vi.mocked(TauriAPI.listDrives).mockResolvedValue([
      { path: '/', letter: '', label: 'Macintosh HD', total_space: 0, free_space: 0 },
    ]);
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

  it('offers to open an explicit web address as a web tab', async () => {
    const onFileSelect = vi.fn();
    render(<CommandPalette isOpen onClose={vi.fn()} onFileSelect={onFileSelect} />);

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'http://127.0.0.1:3080/' },
    });

    const openSite = await screen.findByRole('option', { name: /Open website/ });
    fireEvent.click(openSite);
    // The web tab is created by the navigation layer, which treats http(s) as a page.
    await waitFor(() => expect(onFileSelect).toHaveBeenCalledWith('http://127.0.0.1:3080/', true));
  });

  it('does not treat a plain search term as a web address', async () => {
    render(<CommandPalette isOpen onClose={vi.fn()} onFileSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'quarterly report' } });
    await waitFor(() => expect(TauriAPI.findFiles).toHaveBeenCalled());
    expect(screen.queryByRole('option', { name: /Open website/ })).not.toBeInTheDocument();
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

  it('keeps a slower system search from replacing the latest query results', async () => {
    const firstSearch = deferred<string[]>();
    const secondSearch = deferred<string[]>();
    vi.mocked(TauriAPI.findFiles)
      .mockReturnValueOnce(firstSearch.promise)
      .mockReturnValueOnce(secondSearch.promise);

    render(<CommandPalette isOpen onClose={vi.fn()} currentPath="/Users/test/Documents" />);
    const input = screen.getByRole('combobox', { name: 'Search files and folders...' });

    fireEvent.change(input, { target: { value: 'first query' } });
    await waitFor(() => expect(TauriAPI.findFiles).toHaveBeenCalledWith('first query', '/'));

    fireEvent.change(input, { target: { value: 'latest query' } });
    await waitFor(() => expect(TauriAPI.findFiles).toHaveBeenCalledWith('latest query', '/'));

    await act(async () => {
      firstSearch.resolve(['/search/stale-result.txt']);
      await firstSearch.promise;
    });
    expect(screen.queryByText('stale-result.txt')).not.toBeInTheDocument();

    await act(async () => {
      secondSearch.resolve(['/search/latest-result.txt']);
      await secondSearch.promise;
    });
    expect(await screen.findByText('latest-result.txt')).toBeInTheDocument();
  });

  it('invalidates an in-flight file search when switching to assistant mode', async () => {
    const fileSearch = deferred<string[]>();
    vi.mocked(TauriAPI.findFiles).mockReturnValueOnce(fileSearch.promise);

    render(<CommandPalette isOpen onClose={vi.fn()} currentPath="/Users/test/Documents" />);
    const input = screen.getByRole('combobox', { name: 'Search files and folders...' });
    fireEvent.change(input, { target: { value: 'quarterly report' } });
    await waitFor(() => expect(TauriAPI.findFiles).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('tab', { name: 'Ask Wisp' }));
    await act(async () => {
      fileSearch.resolve(['/search/stale-report.pdf']);
      await fileSearch.promise;
    });

    expect(screen.queryByText('stale-report.pdf')).not.toBeInTheDocument();
    expect(screen.queryByText('Searching files...')).not.toBeInTheDocument();
  });

  it('searches every volume root through the OS provider and classifies folders explicitly', async () => {
    vi.mocked(TauriAPI.findFiles).mockResolvedValue(['/elsewhere/Folder.with.dot']);
    vi.mocked(TauriAPI.isDir).mockResolvedValue(true);
    const onFileSelect = vi.fn();
    const { rerender } = render(
      <CommandPalette isOpen onClose={vi.fn()} onFileSelect={onFileSelect} currentPath="/old" />,
    );
    const input = screen.getByRole('combobox', { name: 'Search files and folders...' });
    fireEvent.change(input, { target: { value: 'folder' } });
    await waitFor(() => expect(TauriAPI.findFiles).toHaveBeenCalledWith('folder', '/'));

    // Results come from the OS provider, not from the pane the palette was opened in.
    rerender(
      <CommandPalette isOpen onClose={vi.fn()} onFileSelect={onFileSelect} currentPath="/new" />,
    );
    const folder = await screen.findByRole('option', { name: /Folder\.with\.dot/ });

    expect(TauriAPI.findFiles).toHaveBeenCalledOnce();

    fireEvent.click(folder);
    await waitFor(() =>
      expect(onFileSelect).toHaveBeenCalledWith('/elsewhere/Folder.with.dot', true),
    );
    expect(TauriAPI.isDir).toHaveBeenCalledWith('/elsewhere/Folder.with.dot');
  });

  it('shows complete wrapped paths for identical names and supports one Chinese character', async () => {
    const paths = [
      '/Users/test/Documents/客户/2026/设计方案.docx',
      '/Volumes/Archive/非常长的项目资料路径/历史版本/设计方案.docx',
    ];
    vi.mocked(TauriAPI.findFiles).mockResolvedValue(paths);
    render(<CommandPalette isOpen onClose={vi.fn()} currentPath="wisp://home" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '设' } });
    for (const path of paths) {
      expect(await screen.findByText(path)).toHaveStyle({
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
      });
    }
    expect(screen.getAllByText('设计方案.docx')).toHaveLength(2);
    expect(screen.getByText('Everywhere')).toBeInTheDocument();
    expect(TauriAPI.findFiles).toHaveBeenCalledWith('设', '/');
  });

  it('reports unavailable sources rather than presenting a failed search as no matches', async () => {
    vi.mocked(TauriAPI.findFiles).mockRejectedValue(new Error('unavailable'));
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'notes' } });
    expect(
      await screen.findByText('Search is unavailable. Please try again shortly.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No matching files')).not.toBeInTheDocument();
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

  it('restores focus to the opener when the overlay unmounts', async () => {
    const previous = document.createElement('button');
    const trigger = document.createElement('button');
    trigger.dataset.commandPaletteTrigger = '';
    vi.spyOn(previous, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    document.body.append(previous, trigger);
    previous.focus();

    const { unmount } = render(
      <CommandPalette isOpen onClose={vi.fn()} currentPath="/Users/test/Documents" />,
    );
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Search files and folders...' })).toHaveFocus(),
    );

    unmount();
    await waitFor(() => expect(previous).toHaveFocus());
    previous.remove();
    trigger.remove();
  });

  it('falls back to the visible compact trigger after the opener is removed', async () => {
    const previous = document.createElement('button');
    const hiddenTrigger = document.createElement('button');
    const compactTrigger = document.createElement('button');
    hiddenTrigger.dataset.commandPaletteTrigger = '';
    compactTrigger.dataset.commandPaletteTrigger = '';
    vi.spyOn(compactTrigger, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    document.body.append(previous, hiddenTrigger, compactTrigger);
    previous.focus();

    const { unmount } = render(
      <CommandPalette isOpen onClose={vi.fn()} currentPath="/Users/test/Documents" />,
    );
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Search files and folders...' })).toHaveFocus(),
    );
    previous.remove();
    unmount();

    await waitFor(() => expect(compactTrigger).toHaveFocus());
    hiddenTrigger.remove();
    compactTrigger.remove();
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
