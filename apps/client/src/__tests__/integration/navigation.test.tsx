import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('@/lib/constants', () => ({
  isWindows: true,
  isMac: false,
  PATH_SEPARATOR: '\\',
  ROOT_PATH: 'C:\\',
}));

const {
  mockIndexDirectory,
  mockSetSearchContext,
  mockStartWatching,
  mockAddWhitelistedPath,
  mockGetBookmarks,
  mockGetUserDirectories,
  mockListDrives,
  mockGetRecentFiles,
} = vi.hoisted(() => ({
  mockIndexDirectory: vi.fn(() => Promise.resolve()),
  mockSetSearchContext: vi.fn(() => Promise.resolve()),
  mockStartWatching: vi.fn(() => Promise.resolve()),
  mockAddWhitelistedPath: vi.fn(() => Promise.resolve()),
  mockGetBookmarks: vi.fn(() => Promise.resolve([])),
  mockGetUserDirectories: vi.fn(() =>
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
  mockListDrives: vi.fn(() =>
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
  mockGetRecentFiles: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    readDirectory: vi.fn(() => Promise.resolve([])),
    indexDirectory: mockIndexDirectory,
    setSearchContext: mockSetSearchContext,
    startWatching: mockStartWatching,
    addWhitelistedPath: mockAddWhitelistedPath,
    getUserDirectories: mockGetUserDirectories,
    listDrives: mockListDrives,
    getBookmarks: mockGetBookmarks,
    removeBookmark: vi.fn(() => Promise.resolve()),
    getRecentFiles: mockGetRecentFiles,
    getFileProperties: vi.fn(() => Promise.resolve({})),
    getFileIcon: vi.fn(() => '📄'),
    formatFileSize: vi.fn(() => '1 KB'),
    formatDate: vi.fn(() => '2024-01-01'),
  },
  FileEntry: {},
}));

vi.mock('@/lib/extension-host', () => ({
  extensionHost: {
    subscribe: vi.fn(() => () => {}),
    getSnapshotVersion: vi.fn(() => 0),
    isExtensionScheme: vi.fn(() => false),
    getTabRenderer: vi.fn(() => null),
    getNavigationEntries: vi.fn(() => []),
    onChange: vi.fn(() => () => {}),
    getSidebarTabs: vi.fn(() => []),
    getSidebarTabRenderer: vi.fn(() => null),
  },
}));

vi.mock('@/lib/collections', () => ({
  getCollections: vi.fn(() => []),
  getAllCollections: vi.fn(() => []),
  deleteCollection: vi.fn(),
  getCollection: vi.fn(() => null),
  isQuickFilter: vi.fn(() => false),
  isSmartFolder: vi.fn(() => false),
}));

vi.mock('@/lib/folder-colors', () => ({
  getFolderColorHex: vi.fn(() => null),
  getAllFolderColors: vi.fn(() => ({})),
}));

vi.mock('@/lib/path-bookmarks', () => ({
  getPathBookmarks: vi.fn(() => []),
  removePathBookmark: vi.fn(),
  getFolderName: vi.fn((path: string) => path.split(/[/\\]/).pop() || path),
}));

import { useNavigation } from '@/hooks/use-navigation';
import NavigationBar from '@/components/explorer/NavigationBar';
import LeftSidebar from '@/components/explorer/LeftSidebar';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';

describe('Navigation Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('Directory Navigation via useNavigation', () => {
    function createNavigationDeps(overrides: Record<string, unknown> = {}) {
      return {
        currentPath: 'C:\\Users\\Test',
        splitLayout: {
          navigate: vi.fn(),
          navigateBack: vi.fn(),
          navigateForward: vi.fn(),
          addTab: vi.fn(),
          switchTab: vi.fn(),
        },
        activeGroup: {
          id: 'default',
          tabs: [{ id: 'tab-1', name: 'Test', path: 'C:\\Users\\Test', type: 'folder' }],
          activeTabId: 'tab-1',
          pathHistory: ['C:\\Users\\Test'],
          historyIndex: 0,
        },
        ...overrides,
      };
    }

    it('navigates to a new directory path', () => {
      const deps = createNavigationDeps();
      const { result } = renderHook(() => useNavigation(deps));

      act(() => {
        result.current.navigateToPath('C:\\Users\\Test\\Documents');
      });

      expect(deps.splitLayout.navigate).toHaveBeenCalledWith(
        'default',
        'C:\\Users\\Test\\Documents',
        'Documents',
      );
    });

    it('does not navigate when target path matches current path', () => {
      const deps = createNavigationDeps();
      const { result } = renderHook(() => useNavigation(deps));

      act(() => {
        result.current.navigateToPath('C:\\Users\\Test');
      });

      expect(deps.splitLayout.navigate).not.toHaveBeenCalled();
    });

    it('indexes the directory on navigation', () => {
      vi.useFakeTimers();
      const deps = createNavigationDeps();
      const { result } = renderHook(() => useNavigation(deps));

      act(() => {
        result.current.navigateToPath('C:\\Users\\Test\\Projects');
      });

      act(() => vi.advanceTimersByTime(1000));

      expect(mockIndexDirectory).toHaveBeenCalledWith('C:\\Users\\Test\\Projects');
      vi.useRealTimers();
    });

    it('sets the search context on navigation', () => {
      const deps = createNavigationDeps();
      const { result } = renderHook(() => useNavigation(deps));

      act(() => {
        result.current.navigateToPath('C:\\Users\\Test\\Downloads');
      });

      expect(mockSetSearchContext).toHaveBeenCalledWith('C:\\Users\\Test\\Downloads');
    });

    it('starts a search watcher on navigation', () => {
      const deps = createNavigationDeps();
      const { result } = renderHook(() => useNavigation(deps));

      act(() => {
        result.current.navigateToPath('D:\\Projects');
      });

      expect(mockStartWatching).toHaveBeenCalledWith('D:\\Projects');
    });

    it('does not index wisp:// protocol paths', () => {
      const deps = createNavigationDeps();
      const { result } = renderHook(() => useNavigation(deps));

      act(() => {
        result.current.navigateToHome();
      });

      expect(mockIndexDirectory).not.toHaveBeenCalled();
      expect(mockSetSearchContext).not.toHaveBeenCalled();
    });

    it('navigates up to parent directory', () => {
      const deps = createNavigationDeps({
        currentPath: 'C:\\Users\\Test\\Documents\\Projects',
      });
      const { result } = renderHook(() => useNavigation(deps));

      act(() => {
        result.current.navigateUp();
      });

      expect(deps.splitLayout.navigate).toHaveBeenCalledWith(
        'default',
        expect.stringContaining('Documents'),
        expect.any(String),
      );
    });

    it('does not navigate up when at wisp://home', () => {
      const deps = createNavigationDeps({ currentPath: 'wisp://home' });
      const { result } = renderHook(() => useNavigation(deps));

      act(() => {
        result.current.navigateUp();
      });

      expect(deps.splitLayout.navigate).not.toHaveBeenCalled();
    });

    it('does not navigate up when at drive root', () => {
      const deps = createNavigationDeps({ currentPath: 'C:\\' });
      const { result } = renderHook(() => useNavigation(deps));

      act(() => {
        result.current.navigateUp();
      });

      expect(deps.splitLayout.navigate).not.toHaveBeenCalled();
    });

    it('navigates to home via navigateToHome', () => {
      const deps = createNavigationDeps();
      const { result } = renderHook(() => useNavigation(deps));

      act(() => {
        result.current.navigateToHome();
      });

      expect(deps.splitLayout.navigate).toHaveBeenCalledWith('default', 'wisp://home', 'home');
    });
  });

  describe('Back/Forward Navigation', () => {
    it('navigates back in history', () => {
      const deps = {
        currentPath: 'C:\\Users\\Test\\Documents',
        splitLayout: {
          navigate: vi.fn(),
          navigateBack: vi.fn(),
          navigateForward: vi.fn(),
          addTab: vi.fn(),
          switchTab: vi.fn(),
        },
        activeGroup: {
          id: 'default',
          tabs: [
            { id: 'tab-1', name: 'Documents', path: 'C:\\Users\\Test\\Documents', type: 'folder' },
          ],
          activeTabId: 'tab-1',
          pathHistory: ['C:\\Users\\Test', 'C:\\Users\\Test\\Documents'],
          historyIndex: 1,
        },
      };
      const { result } = renderHook(() => useNavigation(deps));

      expect(result.current.canNavigateBackInHistory()).toBe(true);

      act(() => {
        result.current.navigateBackInHistory();
      });

      expect(deps.splitLayout.navigateBack).toHaveBeenCalledWith('default');
    });

    it('navigates forward in history', () => {
      const deps = {
        currentPath: 'C:\\Users\\Test',
        splitLayout: {
          navigate: vi.fn(),
          navigateBack: vi.fn(),
          navigateForward: vi.fn(),
          addTab: vi.fn(),
          switchTab: vi.fn(),
        },
        activeGroup: {
          id: 'default',
          tabs: [{ id: 'tab-1', name: 'Test', path: 'C:\\Users\\Test', type: 'folder' }],
          activeTabId: 'tab-1',
          pathHistory: [
            'C:\\Users\\Test',
            'C:\\Users\\Test\\Documents',
            'C:\\Users\\Test\\Documents\\Projects',
          ],
          historyIndex: 0,
        },
      };
      const { result } = renderHook(() => useNavigation(deps));

      expect(result.current.canNavigateForwardInHistory()).toBe(true);

      act(() => {
        result.current.navigateForwardInHistory();
      });

      expect(deps.splitLayout.navigateForward).toHaveBeenCalledWith('default');
    });

    it('reports cannot go back when at start of history', () => {
      const deps = {
        currentPath: 'C:\\Users\\Test',
        splitLayout: {
          navigate: vi.fn(),
          navigateBack: vi.fn(),
          navigateForward: vi.fn(),
          addTab: vi.fn(),
          switchTab: vi.fn(),
        },
        activeGroup: {
          id: 'default',
          tabs: [{ id: 'tab-1', name: 'Test', path: 'C:\\Users\\Test', type: 'folder' }],
          activeTabId: 'tab-1',
          pathHistory: ['C:\\Users\\Test'],
          historyIndex: 0,
        },
      };
      const { result } = renderHook(() => useNavigation(deps));

      expect(result.current.canNavigateBackInHistory()).toBe(false);
    });

    it('reports cannot go forward when at end of history', () => {
      const deps = {
        currentPath: 'C:\\Users\\Test\\Documents',
        splitLayout: {
          navigate: vi.fn(),
          navigateBack: vi.fn(),
          navigateForward: vi.fn(),
          addTab: vi.fn(),
          switchTab: vi.fn(),
        },
        activeGroup: {
          id: 'default',
          tabs: [
            { id: 'tab-1', name: 'Documents', path: 'C:\\Users\\Test\\Documents', type: 'folder' },
          ],
          activeTabId: 'tab-1',
          pathHistory: ['C:\\Users\\Test', 'C:\\Users\\Test\\Documents'],
          historyIndex: 1,
        },
      };
      const { result } = renderHook(() => useNavigation(deps));

      expect(result.current.canNavigateForwardInHistory()).toBe(false);
    });
  });

  describe('Breadcrumb Navigation', () => {
    it('renders breadcrumb segments for a Windows path', () => {
      const navigateToPath = vi.fn();

      render(
        <NavigationBar
          currentPath="C:\\Users\\Test\\Documents\\Projects"
          navigateToPath={navigateToPath}
        />,
      );

      expect(screen.getByText('C:')).toBeInTheDocument();
      expect(screen.getByText('Users')).toBeInTheDocument();
      expect(screen.getByText('Test')).toBeInTheDocument();
      expect(screen.getByText('Documents')).toBeInTheDocument();
      expect(screen.getByText('Projects')).toBeInTheDocument();
    });

    it('navigates to a breadcrumb segment when clicked', () => {
      const navigateToPath = vi.fn();

      render(
        <NavigationBar
          currentPath="C:\\Users\\Test\\Documents\\Projects"
          navigateToPath={navigateToPath}
        />,
      );

      fireEvent.click(screen.getByText('Documents'));

      expect(navigateToPath).toHaveBeenCalledWith(expect.stringContaining('Documents'));
    });

    it('navigates to drive root when drive breadcrumb is clicked', () => {
      const navigateToPath = vi.fn();

      render(<NavigationBar currentPath="C:\\Users\\Test" navigateToPath={navigateToPath} />);

      fireEvent.click(screen.getByText('C:'));

      expect(navigateToPath).toHaveBeenCalledWith(expect.stringMatching(/^C:\\?/));
    });

    it('renders special label for wisp://home', () => {
      render(<NavigationBar currentPath="wisp://home" navigateToPath={vi.fn()} />);

      expect(screen.getByText('Home')).toBeInTheDocument();
    });

    it('renders special label for wisp://trash', () => {
      render(<NavigationBar currentPath="wisp://trash" navigateToPath={vi.fn()} />);

      expect(screen.getByText('Trash')).toBeInTheDocument();
    });

    it('allows editing path by clicking the navigation bar', async () => {
      const testPath = 'C:\\Users\\Test';
      render(<NavigationBar currentPath={testPath} navigateToPath={vi.fn()} />);

      // The NavigationBar renders a .bg-xp-bg inner div that toggles edit mode on click
      const barInner = document.querySelector('.bg-xp-bg');
      expect(barInner).toBeTruthy();
      fireEvent.click(barInner!);

      const input = screen.getByPlaceholderText('Enter path... (~ for home)');
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue(testPath);
    });

    it('submits edited path on Enter key', async () => {
      const navigateToPath = vi.fn();

      render(<NavigationBar currentPath="C:\\Users\\Test" navigateToPath={navigateToPath} />);

      const barInner = document.querySelector('.bg-xp-bg');
      fireEvent.click(barInner!);

      const input = screen.getByPlaceholderText('Enter path... (~ for home)');
      fireEvent.change(input, { target: { value: 'D:\\NewPath' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      // handleSubmit is async (calls expandTilde), so we need to wait
      await waitFor(() => {
        expect(navigateToPath).toHaveBeenCalledWith('D:\\NewPath');
      });
    });

    it('cancels path editing on Escape key', () => {
      const navigateToPath = vi.fn();

      render(<NavigationBar currentPath="C:\\Users\\Test" navigateToPath={navigateToPath} />);

      const barInner = document.querySelector('.bg-xp-bg');
      fireEvent.click(barInner!);

      const input = screen.getByPlaceholderText('Enter path... (~ for home)');
      fireEvent.change(input, { target: { value: 'D:\\OtherPath' } });
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(navigateToPath).not.toHaveBeenCalled();
      expect(screen.queryByPlaceholderText('Enter path... (~ for home)')).not.toBeInTheDocument();
    });
  });

  describe('Bookmark Navigation', () => {
    it('renders bookmarks in the sidebar and navigates on click', async () => {
      mockGetBookmarks.mockResolvedValueOnce([
        { name: 'Project A', path: 'D:\\Projects\\ProjectA', is_dir: true },
        { name: 'Notes', path: 'C:\\Users\\Test\\Notes', is_dir: true },
      ]);

      const navigateToPath = vi.fn();
      render(
        <LeftSidebar
          currentPath="C:\\Users\\Test"
          navigateToPath={navigateToPath}
          handleFileClick={vi.fn()}
          getFileIcon={(file: FileEntry) => (file.is_dir ? '📁' : '📄')}
        />,
      );

      fireEvent.click(await screen.findByText('FAVORITES'));

      await waitFor(() => {
        expect(screen.getByText('Project A')).toBeInTheDocument();
        expect(screen.getByText('Notes')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Project A'));
      expect(navigateToPath).toHaveBeenCalledWith('D:\\Projects\\ProjectA');
    });

    it('shows empty bookmarks message when no bookmarks exist', async () => {
      mockGetBookmarks.mockResolvedValueOnce([]);

      render(
        <LeftSidebar
          currentPath="C:\\Users\\Test"
          navigateToPath={vi.fn()}
          handleFileClick={vi.fn()}
          getFileIcon={(file: FileEntry) => (file.is_dir ? '📁' : '📄')}
        />,
      );

      fireEvent.click(await screen.findByText('FAVORITES'));

      await waitFor(() => {
        expect(screen.getByText('No bookmarks yet')).toBeInTheDocument();
      });
    });

    it('removes a bookmark when the remove button is clicked', async () => {
      mockGetBookmarks.mockResolvedValueOnce([
        { name: 'RemoveMe', path: 'C:\\Users\\Test\\RemoveMe', is_dir: true },
      ]);

      render(
        <LeftSidebar
          currentPath="C:\\Users\\Test"
          navigateToPath={vi.fn()}
          handleFileClick={vi.fn()}
          getFileIcon={(file: FileEntry) => (file.is_dir ? '📁' : '📄')}
        />,
      );

      fireEvent.click(await screen.findByText('FAVORITES'));

      await waitFor(() => {
        expect(screen.getByText('RemoveMe')).toBeInTheDocument();
      });

      const removeBtn = screen.getByTitle('Remove bookmark');
      fireEvent.click(removeBtn);

      expect(TauriAPI.removeBookmark).toHaveBeenCalledWith('C:\\Users\\Test\\RemoveMe');
    });
  });

  describe('Quick Access Navigation', () => {
    it('renders quick access items and navigates on click', async () => {
      const navigateToPath = vi.fn();
      render(
        <LeftSidebar
          currentPath="C:\\Users\\Test"
          navigateToPath={navigateToPath}
          handleFileClick={vi.fn()}
          getFileIcon={(file: FileEntry) => (file.is_dir ? '📁' : '📄')}
        />,
      );

      await waitFor(() => {
        const labels = screen.getAllByLabelText(/Navigate to .* folder/);
        expect(labels.length).toBeGreaterThanOrEqual(4);
        expect(screen.getByText('Documents')).toBeInTheDocument();
        expect(screen.getByText('Downloads')).toBeInTheDocument();
        expect(screen.getByText('Desktop')).toBeInTheDocument();
        expect(screen.getByText('Pictures')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Documents'));
      expect(navigateToPath).toHaveBeenCalledWith('C:\\Users\\Test\\Documents');

      fireEvent.click(screen.getByText('Downloads'));
      expect(navigateToPath).toHaveBeenCalledWith('C:\\Users\\Test\\Downloads');
    });
  });

  describe('Drive Navigation', () => {
    it('renders available drives and navigates on click', async () => {
      const navigateToPath = vi.fn();
      render(
        <LeftSidebar
          currentPath="C:\\Users\\Test"
          navigateToPath={navigateToPath}
          handleFileClick={vi.fn()}
          getFileIcon={(file: FileEntry) => (file.is_dir ? '📁' : '📄')}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('C:')).toBeInTheDocument();
        expect(screen.getByText('D:')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('D:'));
      expect(navigateToPath).toHaveBeenCalledWith('D:\\');
    });
  });

  describe('navigateFromHome', () => {
    it('creates a new folder tab when navigating from home', () => {
      const deps = {
        currentPath: 'wisp://home',
        splitLayout: {
          navigate: vi.fn(),
          navigateBack: vi.fn(),
          navigateForward: vi.fn(),
          addTab: vi.fn(),
          switchTab: vi.fn(),
        },
        activeGroup: {
          id: 'default',
          tabs: [{ id: 'tab-home', name: 'Home', path: 'wisp://home', type: 'folder' }],
          activeTabId: 'tab-home',
          pathHistory: ['wisp://home'],
          historyIndex: 0,
        },
      };
      const { result } = renderHook(() => useNavigation(deps));

      act(() => {
        result.current.navigateFromHome('C:\\Users\\Test\\Documents');
      });

      expect(deps.splitLayout.addTab).toHaveBeenCalledWith(
        'default',
        expect.objectContaining({
          path: 'C:\\Users\\Test\\Documents',
          type: 'folder',
          name: 'Documents',
        }),
        true,
      );
    });
  });

  describe('Edge Cases', () => {
    it('handles getUserDirectories failure with fallback directories', async () => {
      mockGetUserDirectories.mockRejectedValueOnce(new Error('Access denied'));

      render(
        <LeftSidebar
          currentPath="C:\\Users\\Test"
          navigateToPath={vi.fn()}
          handleFileClick={vi.fn()}
          getFileIcon={(file: FileEntry) => (file.is_dir ? '📁' : '📄')}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText('Home')).toBeInTheDocument();
      });
    });

    it('handles listDrives failure gracefully', async () => {
      mockListDrives.mockRejectedValueOnce(new Error('Drive error'));

      expect(() =>
        render(
          <LeftSidebar
            currentPath="C:\\Users\\Test"
            navigateToPath={vi.fn()}
            handleFileClick={vi.fn()}
            getFileIcon={(file: FileEntry) => (file.is_dir ? '📁' : '📄')}
          />,
        ),
      ).not.toThrow();
    });
  });
});
