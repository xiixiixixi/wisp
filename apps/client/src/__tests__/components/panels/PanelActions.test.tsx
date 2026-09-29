import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import BatchRename from '@/components/panels/performance/BatchRename';
import MetricCards from '@/components/panels/performance/MetricCards';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';

const platform = vi.hoisted(() => ({ isWindows: false, isMac: true }));
vi.mock('@/lib/constants', () => platform);
vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    bulkRename: vi.fn(),
    emptyTrash: vi.fn(),
    getUserDirectories: vi.fn(),
    openFile: vi.fn(),
  },
}));
const files: FileEntry[] = ['one.txt', 'two.txt'].map((name) => ({
  name,
  path: `/work/${name}`,
  size: 1,
  is_dir: false,
  modified: 0,
  file_type: 'text',
}));
const preview = files.map((file) => ({
  original_name: file.name,
  new_name: file.name.replace('.txt', '.md'),
  success: true,
  error: null,
}));
const fillRename = () => {
  fireEvent.change(screen.getByLabelText('Find in file names'), { target: { value: '.txt' } });
  fireEvent.change(screen.getByLabelText('Replace with'), { target: { value: '.md' } });
};

beforeEach(() => {
  vi.clearAllMocks();
  platform.isWindows = false;
  platform.isMac = true;
});
describe('previewed file actions', () => {
  it('requires a new preview after the user changes a rule', async () => {
    vi.mocked(TauriAPI.bulkRename).mockResolvedValue(preview);
    render(<BatchRename files={files} onDone={vi.fn()} />);
    fillRename();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByRole('button', { name: /Rename 2/ });
    fireEvent.change(screen.getByLabelText('Replace with'), { target: { value: '.csv' } });
    expect(screen.queryByRole('button', { name: /Rename 2/ })).not.toBeInTheDocument();
    expect(screen.getByText(/files or rules changed/)).toBeInTheDocument();
    expect(TauriAPI.bulkRename).toHaveBeenCalledTimes(1);
  });
  it('ignores an older preview returned after inputs change', async () => {
    let finish!: (results: typeof preview) => void;
    vi.mocked(TauriAPI.bulkRename).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<BatchRename files={files} onDone={vi.fn()} />);
    fillRename();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    fireEvent.change(screen.getByLabelText('Replace with'), { target: { value: '.csv' } });
    await act(async () => finish(preview));
    expect(screen.queryByRole('button', { name: /Rename 2/ })).not.toBeInTheDocument();
  });
  it('reports partial failure from actual execution results', async () => {
    vi.mocked(TauriAPI.bulkRename)
      .mockResolvedValueOnce(preview)
      .mockResolvedValueOnce([
        preview[0],
        { ...preview[1], success: false, error: 'Permission denied' },
      ]);
    const done = vi.fn();
    render(<BatchRename files={files} onDone={done} />);
    fillRename();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    fireEvent.click(await screen.findByRole('button', { name: /Rename 2/ }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Renamed 1 files; 1 failed.'),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('two.txt: Permission denied');
    expect(TauriAPI.bulkRename).toHaveBeenLastCalledWith(
      ['/work/one.txt', '/work/two.txt'],
      '\\.txt',
      '.md',
      false,
    );
    expect(done).toHaveBeenCalledOnce();
  });
});
describe('system trash actions', () => {
  const props = {
    suggestions: [
      {
        id: 'trash',
        title: 'Trash',
        description: '2 deleted items',
        estimatedSize: 10,
        actionLabel: 'Empty',
        actionType: 'action' as const,
      },
    ],
    allFiles: [],
    isLoading: false,
    onRefresh: vi.fn(),
  };
  it('opens the actual macOS Trash folder without trying unsupported empty commands', async () => {
    vi.mocked(TauriAPI.getUserDirectories).mockResolvedValue({ home: '/Users/test' } as never);
    vi.mocked(TauriAPI.openFile).mockResolvedValue(undefined);
    render(<MetricCards {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open system Trash' }));
    await waitFor(() => expect(TauriAPI.openFile).toHaveBeenCalledWith('/Users/test/.Trash'));
    expect(TauriAPI.emptyTrash).not.toHaveBeenCalled();
  });
  it('requires confirmation before Windows permanent deletion and shows failures', async () => {
    platform.isWindows = true;
    platform.isMac = false;
    vi.mocked(TauriAPI.emptyTrash).mockRejectedValue(new Error('Access denied'));
    render(<MetricCards {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Empty Trash' }));
    expect(TauriAPI.emptyTrash).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('including files deleted outside Wisp');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Empty Trash' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Access denied'));
  });
});
