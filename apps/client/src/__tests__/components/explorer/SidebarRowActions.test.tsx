import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SidebarDrives from '@/components/explorer/sidebar/SidebarDrives';
import { SidebarBookmarkItems } from '@/components/explorer/sidebar/SidebarBookmarks';
import { TauriAPI } from '@/lib/tauri-api';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/constants', () => ({ isWindows: false }));
vi.mock('@/lib/folder-colors', () => ({ getFolderColorHex: () => null }));
vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    listDrives: vi.fn(),
    ejectVolume: vi.fn(),
    getBookmarks: vi.fn(),
    removeBookmark: vi.fn(),
  },
}));

const drives = [
  { letter: '', label: 'Macintosh HD', path: '/', total_space: 0, free_space: 0 },
  { letter: 'C', label: 'System', path: 'C:\\', total_space: 0, free_space: 0 },
  {
    letter: '',
    label: 'Backup',
    path: '/Volumes/Backup',
    total_space: 100 * 1024 ** 3,
    free_space: 40 * 1024 ** 3,
  },
  { letter: '', label: 'Work', path: '/Volumes/Work', total_space: 0, free_space: 0 },
];
const bookmarks = [
  { name: 'Project reports', path: '/Users/example/Project reports', is_dir: true },
  { name: 'Notes.md', path: '/Users/example/Notes.md', is_dir: false },
];

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(TauriAPI.listDrives).mockResolvedValue(drives);
  vi.mocked(TauriAPI.ejectVolume).mockResolvedValue();
  vi.mocked(TauriAPI.getBookmarks).mockResolvedValue(bookmarks);
  vi.mocked(TauriAPI.removeBookmark).mockResolvedValue();
});

afterEach(() => vi.restoreAllMocks());

describe('Sidebar volume actions', () => {
  it('uses the standard eject icon with a reserved action slot and protects system roots', async () => {
    render(
      <aside className="wisp-sidebar">
        <SidebarDrives navigateToPath={vi.fn()} />
      </aside>,
    );
    const eject = await screen.findByRole('button', { name: 'Eject: Backup' });
    expect(eject).toHaveClass('wisp-nav-row-action', 'wisp-drive-eject');
    expect(eject.querySelector('svg')).toHaveClass('lucide-eject');
    expect(eject).toHaveAttribute('title', 'Eject');
    expect(eject).toHaveAttribute('aria-busy', 'false');
    expect(eject.closest('.wisp-nav-row-group')?.querySelector('.wisp-nav-row')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Eject: Macintosh HD' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eject: System' })).not.toBeInTheDocument();
  });

  it('allows keyboard activation without navigating and disables repeated pending requests', async () => {
    const user = userEvent.setup();
    const navigateToPath = vi.fn();
    const pending = deferred();
    vi.mocked(TauriAPI.ejectVolume).mockReturnValueOnce(pending.promise);
    render(<SidebarDrives navigateToPath={navigateToPath} />);
    const drive = await screen.findByRole('button', { name: 'Navigate to Backup' });
    drive.focus();
    await user.tab();
    const eject = screen.getByRole('button', { name: 'Eject: Backup' });
    expect(eject).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(eject).toBeDisabled();
    expect(eject).toHaveAttribute('aria-busy', 'true');
    expect(eject).toHaveAttribute('title', 'Ejecting…');
    expect(eject.querySelector('svg')).toHaveClass('wisp-nav-action-spinner');
    fireEvent.click(eject);
    expect(TauriAPI.ejectVolume).toHaveBeenCalledOnce();
    expect(TauriAPI.ejectVolume).toHaveBeenCalledWith('/Volumes/Backup');
    expect(navigateToPath).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Eject: Work' })).toBeEnabled();
    await act(async () => pending.resolve());
    await waitFor(() => expect(eject).toBeEnabled());
    expect(TauriAPI.listDrives).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledWith({ title: 'Volume ejected' });
  });

  it('restores the eject action after failure and allows a retry', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = deferred();
    vi.mocked(TauriAPI.ejectVolume).mockReturnValueOnce(pending.promise);
    render(<SidebarDrives navigateToPath={vi.fn()} />);
    const eject = await screen.findByRole('button', { name: 'Eject: Backup' });
    await user.click(eject);
    await act(async () => pending.reject(new Error('Volume is busy')));
    await waitFor(() => expect(eject).toBeEnabled());
    expect(eject).toHaveAttribute('aria-busy', 'false');
    expect(eject.querySelector('svg')).toHaveClass('lucide-eject');
    expect(toast).toHaveBeenCalledWith({
      title: 'Failed to eject volume',
      description: 'Error: Volume is busy',
      variant: 'destructive',
    });
    await user.click(eject);
    expect(TauriAPI.ejectVolume).toHaveBeenCalledTimes(2);
  });
});

describe('Sidebar bookmark actions', () => {
  it('uses a named remove icon and the same fixed trailing action slot as volumes', async () => {
    render(<SidebarBookmarkItems currentPath="/Users/example" navigateToPath={vi.fn()} />);
    const remove = await screen.findByRole('button', { name: 'Remove bookmark: Project reports' });
    expect(remove).toHaveClass('wisp-nav-row-action', 'wisp-bookmark-remove');
    expect(remove.querySelector('svg')).toHaveClass('lucide-x');
    expect(remove).toHaveAttribute('title', 'Remove bookmark');
    expect(remove.closest('.wisp-nav-row-group')?.querySelector('.wisp-nav-row')).toBeTruthy();
    expect(remove.textContent).toBe('');
    expect(screen.getByText('Project reports')).toHaveClass('truncate');
  });

  it('keeps remove keyboard reachable and prevents duplicate removal while busy', async () => {
    const user = userEvent.setup();
    const navigateToPath = vi.fn();
    const pending = deferred();
    vi.mocked(TauriAPI.removeBookmark).mockReturnValueOnce(pending.promise);
    render(<SidebarBookmarkItems currentPath="/Users/example" navigateToPath={navigateToPath} />);
    const bookmark = await screen.findByRole('button', { name: 'Project reports' });
    bookmark.focus();
    await user.tab();
    const remove = screen.getByRole('button', { name: 'Remove bookmark: Project reports' });
    expect(remove).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('aria-busy', 'true');
    expect(remove).toHaveAttribute('title', 'Removing bookmark…');
    expect(remove.querySelector('svg')).toHaveClass('wisp-nav-action-spinner');
    fireEvent.click(remove);
    expect(TauriAPI.removeBookmark).toHaveBeenCalledOnce();
    expect(TauriAPI.removeBookmark).toHaveBeenCalledWith('/Users/example/Project reports');
    expect(navigateToPath).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove bookmark: Notes.md' })).toBeEnabled();
    await act(async () => pending.resolve());
    expect(screen.queryByRole('button', { name: /Project reports/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notes.md' })).toBeInTheDocument();
  });

  it('retains the bookmark and restores the button when removal fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = deferred();
    vi.mocked(TauriAPI.removeBookmark).mockReturnValueOnce(pending.promise);
    render(<SidebarBookmarkItems currentPath="/Users/example" navigateToPath={vi.fn()} />);
    const remove = await screen.findByRole('button', { name: 'Remove bookmark: Project reports' });
    await user.click(remove);
    await act(async () => pending.reject(new Error('Access denied')));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not remove this favorite. Please try again.',
    );
    expect(remove).toBeEnabled();
    expect(remove).toHaveAttribute('aria-busy', 'false');
    expect(remove.querySelector('svg')).toHaveClass('lucide-x');
    expect(screen.getByRole('button', { name: 'Project reports' })).toBeInTheDocument();
    await user.click(remove);
    expect(TauriAPI.removeBookmark).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: /Project reports/ })).not.toBeInTheDocument();
  });
});
