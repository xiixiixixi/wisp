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

  // The palette has one purpose, with explicit file and folder filters.
  it('offers All, Files and Folders with one focused search field', async () => {
    render(<CommandPalette isOpen onClose={vi.fn()} currentPath="/Users/test/Documents" />);

    expect(screen.getByRole('tab', { name: 'Files' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Folders' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Ask Wisp' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Commands' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Search files and folders...')).toHaveFocus(),
    );
  });

  it('lets the shared open action resolve the type of a pasted path', async () => {
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

    const goTo = await screen.findByRole('option', { name: /Open this path/ });
    fireEvent.click(goTo);
    await waitFor(() =>
      expect(onFileSelect).toHaveBeenCalledWith('/Users/test/Downloads', undefined, 'open'),
    );
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
    await waitFor(() =>
      expect(onFileSelect).toHaveBeenCalledWith('http://127.0.0.1:3080/', true, 'open'),
    );
  });

  it('does not treat a plain search term as a web address', async () => {
    render(<CommandPalette isOpen onClose={vi.fn()} onFileSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'quarterly report' } });
    await waitFor(() => expect(TauriAPI.findFiles).toHaveBeenCalled());
    expect(screen.queryByRole('option', { name: /Open website/ })).not.toBeInTheDocument();
  });

  it('keeps a leading question mark as a literal file query', async () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '?notes' } });
    expect(input).toHaveValue('?notes');
    await waitFor(() => expect(TauriAPI.findFiles).toHaveBeenCalledWith('?notes', '/'));
    expect(screen.queryByText(/Ask Wisp/)).not.toBeInTheDocument();
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

  it('invalidates an in-flight search when switching result type', async () => {
    const fileSearch = deferred<string[]>();
    vi.mocked(TauriAPI.findFiles)
      .mockReturnValueOnce(fileSearch.promise)
      .mockResolvedValueOnce(['/search/Reports']);
    vi.mocked(TauriAPI.isDir).mockImplementation(async (path) => path === '/search/Reports');
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'report' } });
    await waitFor(() => expect(TauriAPI.findFiles).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('tab', { name: 'Folders' }));
    expect(await screen.findByRole('option', { name: /Reports/ })).toBeInTheDocument();
    await act(async () => {
      fileSearch.resolve(['/search/stale-report.pdf']);
      await fileSearch.promise;
    });
    expect(screen.queryByText('stale-report.pdf')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Reports/ })).toBeInTheDocument();
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
      expect(onFileSelect).toHaveBeenCalledWith('/elsewhere/Folder.with.dot', true, 'open'),
    );
    expect(TauriAPI.isDir).toHaveBeenCalledWith('/elsewhere/Folder.with.dot');
  });

  it('distinguishes identical names by parent path and exposes the selected full path', async () => {
    const paths = [
      '/Users/test/Documents/客户/2026/设计方案.docx',
      '/Volumes/Archive/非常长的项目资料路径/历史版本/设计方案.docx',
    ];
    vi.mocked(TauriAPI.findFiles).mockResolvedValue(paths);
    render(<CommandPalette isOpen onClose={vi.fn()} currentPath="wisp://home" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '设' } });
    expect(await screen.findByText('/Users/test/Documents/客户/2026')).toBeInTheDocument();
    expect(screen.getByText('/Volumes/Archive/非常长的项目资料路径/历史版本')).toBeInTheDocument();
    expect(screen.getByText(paths[0])).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getAllByRole('option')[1]);
    expect(screen.getByText(paths[1])).toBeInTheDocument();
    expect(screen.getAllByText('设计方案.docx')).toHaveLength(2);
    expect(screen.getByText('System-searchable locations · names')).toBeInTheDocument();
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

  it('keeps empty navigation inert and traps focus inside the search dialog', async () => {
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

    expect(backwardsTab.defaultPrevented).toBe(true);
    expect(screen.getByRole('tab', { name: 'All' })).toHaveFocus();
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
    await waitFor(() =>
      expect(onFileSelect).toHaveBeenCalledWith('/recent/Archive.2026', true, 'open'),
    );

    fireEvent.click(screen.getByRole('option', { name: /LICENSE/ }));
    await waitFor(() =>
      expect(onFileSelect).toHaveBeenCalledWith('/recent/LICENSE', false, 'open'),
    );
  });
  it('shows a start-typing guide before the first visit, rather than a failed search state', async () => {
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    expect(await screen.findByText('No recent items yet')).toBeInTheDocument();
    expect(screen.getByText('Type a name to find a file or folder.')).toBeInTheDocument();
    expect(screen.queryByText('No matching files')).not.toBeInTheDocument();
    expect(TauriAPI.findFiles).not.toHaveBeenCalled();
  });

  it('filters recent visits before limiting them and lets arrow keys switch type tabs', async () => {
    vi.mocked(TauriAPI.getRecentFiles).mockResolvedValue([
      ...Array.from({ length: 15 }, (_, n) => ({
        path: `/recent/file-${n}.txt`,
        name: `file-${n}.txt`,
        file_type: 'txt',
        accessed_at: 2,
        size: 1,
      })),
      { path: '/recent/Folder', name: 'Folder', file_type: 'folder', accessed_at: 1, size: 0 },
    ]);
    render(<CommandPalette isOpen onClose={vi.fn()} />);
    await screen.findByRole('option', { name: /file-0/ });
    expect(TauriAPI.getRecentFiles).toHaveBeenCalledWith(200);
    fireEvent.click(screen.getByRole('tab', { name: 'Folders' }));
    expect(screen.getByRole('option', { name: /Folder/ })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Folders' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveFocus();
    expect(screen.getAllByRole('option')).toHaveLength(12);
  });

  it('offers separate open, reveal, and full-path copy actions for the selected item', async () => {
    vi.mocked(TauriAPI.findFiles).mockResolvedValue(['/Documents/notes.txt']);
    const onFileSelect = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      render(<CommandPalette isOpen onClose={vi.fn()} onFileSelect={onFileSelect} />);
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'notes' } });
      await screen.findByRole('option', { name: /notes\.txt/ });
      fireEvent.click(screen.getByRole('button', { name: 'Copy path' }));
      expect(await screen.findByText('Path copied')).toBeInTheDocument();
      expect(writeText).toHaveBeenCalledWith('/Documents/notes.txt');
      fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }));
      await waitFor(() =>
        expect(onFileSelect).toHaveBeenLastCalledWith('/Documents/notes.txt', false, 'reveal'),
      );
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() =>
        expect(onFileSelect).toHaveBeenLastCalledWith('/Documents/notes.txt', false, 'open'),
      );
      fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
      await waitFor(() =>
        expect(onFileSelect).toHaveBeenLastCalledWith('/Documents/notes.txt', false, 'reveal'),
      );
    } finally {
      if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('closes with Escape while focus is on a filter tab', async () => {
    const onClose = vi.fn();
    render(<CommandPalette isOpen onClose={onClose} />);
    await screen.findByText('No recent items yet');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'All' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the latest recent-visit update and stops refreshing after unmount', async () => {
    const first = deferred<Awaited<ReturnType<typeof TauriAPI.getRecentFiles>>>();
    const latest = deferred<Awaited<ReturnType<typeof TauriAPI.getRecentFiles>>>();
    vi.mocked(TauriAPI.getRecentFiles)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(latest.promise);
    const { unmount } = render(<CommandPalette isOpen onClose={vi.fn()} />);
    act(() => window.dispatchEvent(new Event('recent-files-changed')));
    await act(async () => {
      latest.resolve([
        { path: '/recent/latest', name: 'latest', file_type: 'folder', accessed_at: 2, size: 0 },
      ]);
      await latest.promise;
    });
    expect(screen.getByRole('option', { name: /latest/ })).toBeInTheDocument();
    await act(async () => {
      first.resolve([
        { path: '/recent/old', name: 'old', file_type: 'folder', accessed_at: 1, size: 0 },
      ]);
      await first.promise;
    });
    expect(screen.queryByRole('option', { name: /old/ })).not.toBeInTheDocument();
    unmount();
    window.dispatchEvent(new Event('recent-files-changed'));
    expect(TauriAPI.getRecentFiles).toHaveBeenCalledTimes(2);
  });
});
