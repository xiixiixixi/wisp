import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '@/pages/HomePage';
import { homeParentLabel } from '@/lib/home-entry-path';
import { TauriAPI, type RecentFile } from '@/lib/tauri-api';
import { openRecentEntry } from '@/lib/recent-entry-actions';

vi.mock('@/components/explorer/SystemDashboard', () => ({ default: () => null }));
vi.mock('@/lib/utils', () => ({ getFileIcon: () => null }));
vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    getRecentFiles: vi.fn(),
    getBookmarks: vi.fn(),
    getUserDirectories: vi.fn(),
    addBookmark: vi.fn(),
    removeBookmark: vi.fn(),
    removeRecentFile: vi.fn(),
    clearRecentFiles: vi.fn(),
    showOpenDialog: vi.fn(),
  },
}));
vi.mock('@/lib/recent-entry-actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/recent-entry-actions')>()),
  openRecentEntry: vi.fn(),
}));

const folder: RecentFile = {
  path: '/Users/test/Documents/Launch',
  name: 'Launch',
  file_type: 'folder',
  size: 0,
  accessed_at: Date.now(),
};
const file: RecentFile = {
  path: '/Users/test/Documents/Research/Plan.md',
  name: 'Plan.md',
  file_type: 'markdown',
  size: 123,
  accessed_at: Date.now() - 60000,
};
const renderHome = (props = {}) =>
  render(<HomePage onNavigate={vi.fn()} theme="fluid" setTheme={vi.fn()} {...props} />);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(TauriAPI.getRecentFiles).mockResolvedValue([{ ...folder }, { ...file }]);
  vi.mocked(TauriAPI.getBookmarks).mockResolvedValue([]);
  vi.mocked(TauriAPI.getUserDirectories).mockResolvedValue({ home: '/Users/test' } as Awaited<
    ReturnType<typeof TauriAPI.getUserDirectories>
  >);
  vi.mocked(openRecentEntry).mockResolvedValue(undefined);
});

describe('Home entry points', () => {
  it('separates files and folders while showing parent paths without repeating names', async () => {
    renderHome();
    await screen.findByText('Plan.md');
    expect(screen.getByText('~/Documents/Research')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Files', exact: true }));
    expect(screen.queryByText('Launch')).not.toBeInTheDocument();
    expect(screen.getByText('Plan.md')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Files', exact: true }), {
      key: 'ArrowRight',
    });
    expect(screen.getByRole('tab', { name: 'Folders', exact: true })).toHaveFocus();
    expect(screen.getByText('Launch')).toBeInTheDocument();
    expect(screen.queryByText('Plan.md')).not.toBeInTheDocument();
  });

  it('opens the actual entry and offers reveal without opening it', async () => {
    const navigate = vi.fn();
    const preview = vi.fn();
    const reveal = vi.fn();
    renderHome({ onNavigate: navigate, onQuickLook: preview, onReveal: reveal });
    fireEvent.click(await screen.findByRole('button', { name: /Plan.md ~\/Documents\/Research/ }));
    expect(openRecentEntry).toHaveBeenCalledWith({ path: file.path, isDir: false }, navigate, {
      openDemoFile: preview,
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Plan.md ~\/Documents\/Research/ }),
      ).not.toBeDisabled(),
    );
    vi.mocked(openRecentEntry).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Plan.md' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show in folder' }));
    expect(reveal).toHaveBeenCalledWith(file.path);
    expect(openRecentEntry).not.toHaveBeenCalled();
  });

  it('refreshes after history changes and preserves the selected type', async () => {
    renderHome();
    await screen.findByText('Plan.md');
    fireEvent.click(screen.getByRole('tab', { name: 'Files', exact: true }));
    vi.mocked(TauriAPI.getRecentFiles).mockResolvedValue([
      { ...file, name: 'New.md', path: '/Users/test/New.md' },
    ]);
    await act(async () => {
      window.dispatchEvent(new Event('recent-files-changed'));
    });
    expect(screen.getByText('New.md')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Files', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByText('Plan.md')).not.toBeInTheDocument();
  });

  it('keeps failed opens visible with a useful message and never navigates to a parent as success', async () => {
    vi.mocked(openRecentEntry).mockRejectedValue(new Error('missing'));
    const navigate = vi.fn();
    renderHome({ onNavigate: navigate });
    fireEvent.click(await screen.findByRole('button', { name: /Plan.md ~\/Documents\/Research/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check that it exists');
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByText('Plan.md')).toBeInTheDocument();
  });

  it('pins a chosen folder and updates the shared pinned section from its event', async () => {
    vi.mocked(TauriAPI.showOpenDialog).mockResolvedValue(['/Users/test/Documents/Launch']);
    vi.mocked(TauriAPI.addBookmark).mockImplementation(async (path, name) => {
      const bookmark = { path, name, is_dir: true, added_at: new Date().toISOString() };
      vi.mocked(TauriAPI.getBookmarks).mockResolvedValue([bookmark]);
      window.dispatchEvent(new Event('bookmarks-changed'));
      return bookmark;
    });
    renderHome();
    await screen.findByText('Plan.md');
    fireEvent.click(screen.getByRole('button', { name: 'Pin a folder' }));
    const region = await screen.findByRole('region', { name: 'Pinned locations' });
    expect(within(region).getByText('Launch')).toBeInTheDocument();
    expect(TauriAPI.addBookmark).toHaveBeenCalledWith(folder.path, 'Launch');
  });

  it('keeps a useful empty state and moves clear-history into its menu', async () => {
    vi.mocked(TauriAPI.getRecentFiles).mockResolvedValue([]);
    renderHome();
    expect(await screen.findByText('Start with a file or folder')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search files and folders' })).toBeInTheDocument();
  });

  it('does not let an older bookmark response restore an unpinned location', async () => {
    let finishOld!: (entries: Awaited<ReturnType<typeof TauriAPI.getBookmarks>>) => void;
    vi.mocked(TauriAPI.getBookmarks).mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    );
    renderHome();
    await screen.findByText('Plan.md');
    vi.mocked(TauriAPI.getBookmarks).mockResolvedValue([]);
    await act(async () => {
      window.dispatchEvent(new Event('bookmarks-changed'));
    });
    await act(async () => {
      finishOld([
        { path: folder.path, name: folder.name, is_dir: true, added_at: new Date().toISOString() },
      ]);
    });
    expect(screen.queryByRole('region', { name: 'Pinned locations' })).not.toBeInTheDocument();
  });

  it('preserves roots and only abbreviates the actual home directory', () => {
    expect(homeParentLabel('/Plan.md', '/Users/test')).toBe('/');
    expect(homeParentLabel('/Users/test2/Plan.md', '/Users/test')).toBe('/Users/test2');
    expect(homeParentLabel('C:\\Plan.md', 'C:\\Users\\test')).toBe('C:\\');
  });
});
