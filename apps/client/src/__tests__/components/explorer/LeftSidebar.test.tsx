import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createRef } from 'react';
import LeftSidebar, { type LeftSidebarHandle } from '@/components/explorer/LeftSidebar';
import { FileEntry, TauriAPI } from '@/lib/tauri-api';
import { extensionHost } from '@/lib/extension-host';

// Mock constants
vi.mock('@/lib/constants', () => ({
  isWindows: true,
  isMac: false,
  PATH_SEPARATOR: '\\',
  ROOT_PATH: 'C:\\',
}));

// Mock collections
vi.mock('@/lib/collections', () => ({
  getCollections: vi.fn(() => []),
  getAllCollections: vi.fn(() => []),
  deleteCollection: vi.fn(),
  isQuickFilter: vi.fn(() => false),
  isSmartFolder: vi.fn(() => false),
}));

// Mock folder-colors
vi.mock('@/lib/folder-colors', () => ({
  getFolderColorHex: vi.fn(() => null),
  getAllFolderColors: vi.fn(() => ({})),
}));

// Mock path-bookmarks
vi.mock('@/lib/path-bookmarks', () => ({
  getPathBookmarks: vi.fn(() => []),
  removePathBookmark: vi.fn(),
  getFolderName: vi.fn((path: string) => path.split(/[\\/]/).pop() || path),
}));

// Mock extension-host
vi.mock('@/lib/extension-host', () => ({
  extensionHost: {
    subscribe: vi.fn(() => () => {}),
    getSnapshotVersion: vi.fn(() => 0),
    isExtensionScheme: vi.fn(() => false),
    getTabRenderer: vi.fn(() => null),
    getNavigationEntries: vi.fn(() => []),
    getSidebarTabs: vi.fn(() => []),
    getSidebarTabRenderer: vi.fn(() => null),
    onChange: vi.fn(() => () => {}),
  },
}));

// Extend TauriAPI mock for LeftSidebar-specific methods
vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    readDirectory: vi.fn(() => Promise.resolve([])),
    getAllFileTags: vi.fn(() => Promise.resolve([])),
    getUserDirectories: vi.fn(() =>
      Promise.resolve({
        home: 'C:\\Users\\Test',
        documents: 'C:\\Users\\Test\\Documents',
        downloads: 'C:\\Users\\Test\\Downloads',
        desktop: 'C:\\Users\\Test\\Desktop',
        pictures: 'C:\\Users\\Test\\Pictures',
        videos: 'C:\\Users\\Test\\Videos',
        music: 'C:\\Users\\Test\\Music',
      }),
    ),
    listDrives: vi.fn(() =>
      Promise.resolve([
        {
          letter: 'C',
          label: 'Local Disk',
          path: 'C:\\',
          total_space: 500000000000,
          free_space: 200000000000,
        },
        {
          letter: 'D',
          label: 'Data',
          path: 'D:\\',
          total_space: 1000000000000,
          free_space: 500000000000,
        },
      ]),
    ),
    getBookmarks: vi.fn(() => Promise.resolve([])),
    openFile: vi.fn(() => Promise.resolve()),
    removeBookmark: vi.fn(() => Promise.resolve()),
    getRecentFiles: vi.fn(() => Promise.resolve([])),
    getFileIcon: vi.fn(() => '📄'),
    formatFileSize: vi.fn(() => '1 KB'),
    formatDate: vi.fn(() => '2024-01-01'),
  },
  FileEntry: {},
}));

describe('LeftSidebar', () => {
  const mockFiles: FileEntry[] = [
    {
      name: 'folder1',
      path: 'C:\\Users\\Test\\folder1',
      size: 0,
      is_dir: true,
      modified: Date.now(),
      file_type: 'folder',
    },
    {
      name: 'file1.txt',
      path: 'C:\\Users\\Test\\file1.txt',
      size: 1024,
      is_dir: false,
      modified: Date.now(),
      file_type: 'text',
    },
  ];

  const mockProps = {
    currentPath: 'C:\\Users\\Test',
    files: mockFiles,
    navigateToPath: vi.fn(),
    handleFileClick: vi.fn(),
    handleFileRightClick: vi.fn(),
    getFileIcon: vi.fn((file: FileEntry) => (file.is_dir ? '📁' : '📄')),
    sortBy: 'name',
    sortOrder: 'asc' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(extensionHost.getSidebarTabs).mockReturnValue([]);
    vi.mocked(extensionHost.getSidebarTabRenderer).mockReturnValue(null);
  });

  describe('Quick Access Section', () => {
    it('renders quick access header', async () => {
      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('Places')).toBeInTheDocument();
      });
    });

    it('renders Home quick access item', async () => {
      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('Home')).toBeInTheDocument();
      });
    });

    it('renders the user directory in quick access', async () => {
      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('User Folder')).toBeInTheDocument();
      });
    });

    it('renders Documents quick access item', async () => {
      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('Documents')).toBeInTheDocument();
      });
    });

    it('renders Downloads quick access item', async () => {
      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('Downloads')).toBeInTheDocument();
      });
    });

    it('renders Desktop quick access item', async () => {
      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('Desktop')).toBeInTheDocument();
      });
    });

    it('renders Pictures quick access item', async () => {
      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('Pictures')).toBeInTheDocument();
      });
    });

    it('navigates to Home when Home is clicked', async () => {
      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('Home')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Home'));
      expect(mockProps.navigateToPath).toHaveBeenCalledWith('wisp://home');
    });

    it('navigates to the real user directory when clicked', async () => {
      render(<LeftSidebar {...mockProps} />);

      fireEvent.click(await screen.findByText('User Folder'));
      expect(mockProps.navigateToPath).toHaveBeenCalledWith('C:\\Users\\Test');
    });

    it('navigates to Documents when Documents is clicked', async () => {
      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('Documents')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Documents'));
      expect(mockProps.navigateToPath).toHaveBeenCalledWith('C:\\Users\\Test\\Documents');
    });

    it('navigates to Downloads when Downloads is clicked', async () => {
      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('Downloads')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Downloads'));
      expect(mockProps.navigateToPath).toHaveBeenCalledWith('C:\\Users\\Test\\Downloads');
    });
  });

  describe('Quick Access Bookmarks', () => {
    it('keeps favorites in Places without a duplicate section or add action', async () => {
      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('Places')).toBeInTheDocument();
      });

      expect(screen.queryByRole('region', { name: 'Favorites' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Add current folder to favorites' }),
      ).not.toBeInTheDocument();
    });

    it('renders bookmark items when bookmarks exist', async () => {
      vi.mocked(TauriAPI.getBookmarks).mockResolvedValueOnce([
        { name: 'MyFolder', path: 'C:\\Users\\Test\\MyFolder', is_dir: true },
        { name: 'readme.md', path: 'C:\\Users\\Test\\readme.md', is_dir: false },
      ]);

      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('MyFolder')).toBeInTheDocument();
        expect(screen.getByText('readme.md')).toBeInTheDocument();
      });
    });

    it('navigates to bookmark when clicked', async () => {
      vi.mocked(TauriAPI.getBookmarks).mockResolvedValueOnce([
        { name: 'MyFolder', path: 'C:\\Users\\Test\\MyFolder', is_dir: true },
      ]);

      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('MyFolder')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('MyFolder'));
      expect(mockProps.navigateToPath).toHaveBeenCalledWith('C:\\Users\\Test\\MyFolder');
    });

    it('removes bookmark when remove button is clicked', async () => {
      vi.mocked(TauriAPI.getBookmarks).mockResolvedValueOnce([
        { name: 'MyFolder', path: 'C:\\Users\\Test\\MyFolder', is_dir: true },
      ]);

      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('MyFolder')).toBeInTheDocument();
      });

      const removeButton = screen.getByRole('button', { name: /Remove.*MyFolder/i });
      fireEvent.click(removeButton);

      expect(TauriAPI.removeBookmark).toHaveBeenCalledWith('C:\\Users\\Test\\MyFolder');
    });
  });

  describe('Drives Section', () => {
    it('renders drives header for Windows', async () => {
      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('Drives')).toBeInTheDocument();
      });
    });

    it('renders drive list', async () => {
      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        // Component renders drive.letter ? `${drive.letter}:` : drive.label
        expect(screen.getByText('C: Local Disk')).toBeInTheDocument();
        expect(screen.getByText('D: Data')).toBeInTheDocument();
      });
    });

    it('navigates to drive when drive is clicked', async () => {
      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('C: Local Disk')).toBeInTheDocument();
      });

      // The drive button wraps the text; click the text element
      fireEvent.click(screen.getByText('C: Local Disk'));
      expect(mockProps.navigateToPath).toHaveBeenCalledWith('C:\\');
    });
  });

  describe('Simplified Structure', () => {
    it('omits collections, recent files, and file tree sections', async () => {
      render(<LeftSidebar {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('Places')).toBeInTheDocument();
      });

      expect(screen.queryByText('FILTERS')).not.toBeInTheDocument();
      expect(screen.queryByText('RECENT')).not.toBeInTheDocument();
      expect(screen.queryByText('FILE TREE')).not.toBeInTheDocument();
    });

    it('uses the global command palette instead of a duplicate sidebar search tab', () => {
      const openPalette = vi.fn();
      window.addEventListener('wisp-open-command-palette', openPalette);
      const ref = createRef<LeftSidebarHandle>();

      render(<LeftSidebar ref={ref} {...mockProps} />);

      expect(
        screen.queryByRole('tab', { name: /search current folder|搜索当前文件夹/i }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();

      ref.current?.focusSearch();
      expect(openPalette).toHaveBeenCalledOnce();
      window.removeEventListener('wisp-open-command-palette', openPalette);
    });

    it('keeps extension sidebar tabs available without restoring the search tab', () => {
      vi.mocked(extensionHost.getSidebarTabs).mockReturnValue([
        { id: 'notes', title: 'Notes', icon: <span aria-hidden="true">N</span> },
      ]);
      vi.mocked(extensionHost.getSidebarTabRenderer).mockReturnValue(() => (
        <div>Notes extension</div>
      ));

      render(<LeftSidebar {...mockProps} />);

      expect(screen.getByRole('tab', { name: /file explorer|文件浏览器/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Notes' })).toBeInTheDocument();
      expect(
        screen.queryByRole('tab', { name: /search current folder|搜索当前文件夹/i }),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
      expect(screen.getByText('Notes extension')).toBeInTheDocument();
    });
  });

  describe('Navigation interactions', () => {
    it('opens a file favorite with the file action instead of navigating to it as a folder', async () => {
      vi.mocked(TauriAPI.getBookmarks).mockResolvedValueOnce([
        { name: 'notes.txt', path: 'C:\\notes.txt', is_dir: false },
      ]);
      const open = vi.fn();
      render(<LeftSidebar {...mockProps} handleFileOpen={open} />);
      fireEvent.click(await screen.findByRole('button', { name: 'notes.txt' }));
      expect(open).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'C:\\notes.txt', is_dir: false }),
      );
      expect(mockProps.navigateToPath).not.toHaveBeenCalled();
    });

    it('shows a recoverable failure and keeps the favorite when removal fails', async () => {
      vi.mocked(TauriAPI.getBookmarks).mockResolvedValueOnce([
        { name: 'Notes', path: 'C:\\Notes', is_dir: true },
      ]);
      vi.mocked(TauriAPI.removeBookmark).mockRejectedValueOnce(new Error('Access denied'));
      render(<LeftSidebar {...mockProps} />);
      fireEvent.click(await screen.findByRole('button', { name: /Remove.*Notes/i }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not remove this favorite');
      expect(screen.getByRole('button', { name: 'Notes', exact: true })).toBeInTheDocument();
    });

    it('marks only the closest common location, with the containing drive also identified', async () => {
      render(<LeftSidebar {...mockProps} currentPath={'C:\\Users\\Test\\Documents\\Reports'} />);
      expect(
        await screen.findByRole('button', { name: 'Navigate to Documents folder' }),
      ).toHaveAttribute('aria-current', 'location');
      expect(
        screen.getByRole('button', { name: 'Navigate to User Folder folder' }),
      ).not.toHaveAttribute('aria-current');
      expect(screen.getByRole('button', { name: 'Navigate to C:' })).toHaveAttribute(
        'aria-current',
        'location',
      );
    });

    it('retries failed locations without offering fabricated paths', async () => {
      vi.mocked(TauriAPI.getUserDirectories).mockRejectedValueOnce(new Error('Unavailable'));
      render(<LeftSidebar {...mockProps} />);
      const places = screen.getByRole('region', { name: 'Places' });
      fireEvent.click(await within(places).findByRole('button', { name: 'Try again' }));
      expect(
        await within(places).findByRole('button', { name: 'Navigate to Documents folder' }),
      ).toBeInTheDocument();
      expect(TauriAPI.getUserDirectories).toHaveBeenCalledTimes(2);
    });

    it('switches extension tabs with arrow keys and keeps their visible names', () => {
      vi.mocked(extensionHost.getSidebarTabs).mockReturnValue([
        { id: 'notes', title: 'Notes', icon: <span>N</span> },
      ]);
      vi.mocked(extensionHost.getSidebarTabRenderer).mockReturnValue(() => (
        <div>Notes extension</div>
      ));
      render(<LeftSidebar {...mockProps} />);
      const explorer = screen.getByRole('tab', { name: 'File explorer' });
      explorer.focus();
      fireEvent.keyDown(explorer, { key: 'ArrowRight' });
      expect(screen.getByRole('tab', { name: 'Notes' })).toHaveFocus();
      expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Notes extension')).toBeInTheDocument();
    });
  });

  describe('Layout', () => {
    it('applies correct container styles', () => {
      const { container } = render(<LeftSidebar {...mockProps} />);

      const sidebar = container.firstChild as HTMLElement;
      expect(sidebar).not.toHaveClass('bg-xp-surface');
      expect(sidebar).toHaveClass('border-r', 'border-xp-border', 'flex', 'flex-col');
    });

    it('applies default width when width prop not provided', () => {
      const { container } = render(<LeftSidebar {...mockProps} />);

      const sidebar = container.firstChild as HTMLElement;
      expect(sidebar.style.width).toBe('256px');
    });

    it('applies custom width when width prop provided', () => {
      const { container } = render(<LeftSidebar {...mockProps} width={300} />);

      const sidebar = container.firstChild as HTMLElement;
      expect(sidebar.style.width).toBe('300px');
    });

    it('does not retain onboarding markers', () => {
      const { container } = render(<LeftSidebar {...mockProps} />);

      const sidebar = container.firstChild as HTMLElement;
      expect(sidebar).not.toHaveAttribute('data-tour');
    });

    it('prevents navigation labels from being selected during drag gestures', () => {
      const { container } = render(<LeftSidebar {...mockProps} />);

      const sidebar = container.firstChild as HTMLElement;
      expect(sidebar).toHaveClass('wisp-no-select');
    });
  });

  describe('Edge Cases', () => {
    it('handles getUserDirectories failure gracefully', async () => {
      vi.mocked(TauriAPI.getUserDirectories).mockRejectedValueOnce(new Error('Access denied'));

      expect(() => render(<LeftSidebar {...mockProps} />)).not.toThrow();

      // Home remains usable while actual folders can be retried.
      await waitFor(() => {
        expect(screen.getByText('Home')).toBeInTheDocument();
      });
    });

    it('handles listDrives failure gracefully', async () => {
      vi.mocked(TauriAPI.listDrives).mockRejectedValueOnce(new Error('Access denied'));

      expect(() => render(<LeftSidebar {...mockProps} />)).not.toThrow();
    });

    it('handles getBookmarks failure gracefully', async () => {
      vi.mocked(TauriAPI.getBookmarks).mockRejectedValueOnce(new Error('DB error'));

      expect(() => render(<LeftSidebar {...mockProps} />)).not.toThrow();
    });

    it('handles empty files array', () => {
      const emptyProps = { ...mockProps, files: [] };
      expect(() => render(<LeftSidebar {...emptyProps} />)).not.toThrow();
    });
  });
});
