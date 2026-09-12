import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import FileGrid from '@/components/explorer/FileGrid';
import { FileEntry, FolderSizeInfo } from '@/lib/tauri-api';
import { requestAdjacentFile } from '@/lib/file-navigation';
import type { FileGroup } from '@/lib/utils';
import * as locale from '@/lib/locale';

// Mock the drag/drop hooks
vi.mock('@/hooks/use-draggable', () => ({
  useDraggable: () => ({
    onMouseDown: vi.fn(),
    onMouseMove: vi.fn(),
    onMouseUp: vi.fn(),
    onMouseLeave: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-droppable', () => ({
  useDroppable: () => ({ current: null }),
}));

vi.mock('@/contexts/DragDropContext', () => ({
  useDragDropContext: () => ({
    startInternalDrag: vi.fn(),
  }),
}));

vi.mock('@crabnebula/tauri-plugin-drag', () => ({
  startDrag: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    scrollToIndex: vi.fn(),
  }),
}));

describe('FileGrid', () => {
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
      name: 'document.txt',
      path: 'C:\\Users\\Test\\document.txt',
      size: 1024,
      is_dir: false,
      modified: Date.now() - 86400000,
      file_type: 'text',
    },
    {
      name: 'image.png',
      path: 'C:\\Users\\Test\\image.png',
      size: 2048,
      is_dir: false,
      modified: Date.now() - 172800000,
      file_type: 'image',
    },
  ];

  const mockProps = {
    files: mockFiles,
    isLoading: false,
    viewMode: 'medium',
    selectedFiles: new Set<string>(),
    currentPath: 'C:\\Users\\Test',
    groupId: 'main',
    getFileIcon: vi.fn((file: FileEntry) => (file.is_dir ? '📁' : '📄')),
    formatFileSize: vi.fn((bytes: number) => `${bytes} B`),
    formatFolderSize: vi.fn((info: FolderSizeInfo | null, isCalculating?: boolean) => {
      if (isCalculating) return 'Calculating...';
      return info ? `${info.file_count} items` : '--';
    }),
    formatDate: vi.fn((timestamp: number) => new Date(timestamp).toLocaleDateString()),
    handleFileClick: vi.fn(),
    handleFileDoubleClick: vi.fn(),
    handleFileRightClick: vi.fn(),
    handleBackgroundRightClick: vi.fn(),
    getFolderSize: vi.fn(
      () =>
        ({
          file_count: 5,
          total_size: 10240,
          dir_count: 1,
          is_cached: false,
          cache_timestamp: 0,
        }) as FolderSizeInfo,
    ),
    isCalculatingSize: vi.fn(() => false),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading and Empty States', () => {
    it('shows loading state', () => {
      const loadingProps = { ...mockProps, isLoading: true };
      render(<FileGrid {...loadingProps} />);

      // FileGrid renders a FileGridSkeleton with role="status" and aria-label="Loading files"
      expect(screen.getByRole('status', { name: 'Loading files' })).toBeInTheDocument();
    });

    it('shows empty state when no files', () => {
      const emptyProps = { ...mockProps, files: [] };
      render(<FileGrid {...emptyProps} />);

      expect(screen.getByText('This folder is empty')).toBeInTheDocument();
    });
  });

  describe('File Interactions', () => {
    it('renders all files', () => {
      render(<FileGrid {...mockProps} />);

      expect(screen.getByText('folder1')).toBeInTheDocument();
      expect(screen.getByText('document.txt')).toBeInTheDocument();
      expect(screen.getByText('image.png')).toBeInTheDocument();
    });

    it('calls handleFileClick when file is clicked', () => {
      render(<FileGrid {...mockProps} />);

      const file = screen.getByText('document.txt');
      const fileItem = file.closest('[role="option"]')!;
      fireEvent.click(fileItem);

      expect(mockProps.handleFileClick).toHaveBeenCalledWith(mockFiles[1], expect.any(Object));
    });

    it('calls handleFileDoubleClick when file is double-clicked', () => {
      render(<FileGrid {...mockProps} />);

      const file = screen.getByText('document.txt');
      const fileItem = file.closest('[role="option"]')!;
      fireEvent.doubleClick(fileItem);

      expect(mockProps.handleFileDoubleClick).toHaveBeenCalledWith(mockFiles[1]);
    });

    it('calls handleFileRightClick when file is right-clicked', () => {
      render(<FileGrid {...mockProps} />);

      const file = screen.getByText('document.txt');
      const fileItem = file.closest('[role="option"]')!;
      fireEvent.contextMenu(fileItem);

      expect(mockProps.handleFileRightClick).toHaveBeenCalledWith(mockFiles[1], expect.any(Object));
    });

    it('calls handleBackgroundRightClick when background is right-clicked', () => {
      render(<FileGrid {...mockProps} />);

      const grid = document.querySelector('.grid, .space-y-0');
      if (grid) {
        fireEvent.contextMenu(grid);
        expect(mockProps.handleBackgroundRightClick).toHaveBeenCalled();
      }
    });
  });

  describe('File Selection', () => {
    it('highlights selected files', () => {
      const selectedProps = {
        ...mockProps,
        selectedFiles: new Set(['C:\\Users\\Test\\document.txt']),
      };
      render(<FileGrid {...selectedProps} />);

      const selectedFile = screen.getByText('document.txt').closest('[role="option"]');
      expect(selectedFile).toHaveAttribute('aria-selected', 'true');
    });

    it('does not highlight unselected files', () => {
      render(<FileGrid {...mockProps} />);

      const unselectedFile = screen.getByText('document.txt').closest('[role="option"]');
      expect(unselectedFile).toHaveAttribute('aria-selected', 'false');
    });
  });

  describe('Visible-order keyboard navigation', () => {
    it.each([
      ['ArrowUp', 0],
      ['ArrowDown', 2],
    ] as const)(
      'selects the adjacent details row with %s and consumes the key',
      async (key, target) => {
        render(<FileGrid {...mockProps} viewMode="details" />);
        const current = screen.getByRole('row', { name: 'document.txt' });
        current.focus();
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

        fireEvent(current, event);

        expect(event.defaultPrevented).toBe(true);
        expect(mockProps.handleFileClick).toHaveBeenCalledOnce();
        expect(mockProps.handleFileClick).toHaveBeenCalledWith(
          mockFiles[target],
          expect.objectContaining({ shiftKey: false, ctrlKey: false, metaKey: false }),
        );
        await waitFor(() =>
          expect(screen.getByRole('row', { name: mockFiles[target].name })).toHaveFocus(),
        );
      },
    );

    it('uses date-group order for both details arrows and adjacent-file requests', async () => {
      const groups: FileGroup[] = [
        { group: 'Today', files: [mockFiles[2]] },
        { group: 'Yesterday', files: [mockFiles[0], mockFiles[1]] },
      ];
      render(<FileGrid {...mockProps} viewMode="details" fileGroups={groups} />);
      const rows = screen.getAllByRole('row').filter((row) => row.hasAttribute('data-file-path'));
      expect(rows.map((row) => row.getAttribute('data-file-path'))).toEqual([
        mockFiles[2].path,
        mockFiles[0].path,
        mockFiles[1].path,
      ]);
      rows[0].focus();
      const down = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      });
      fireEvent(rows[0], down);
      expect(down.defaultPrevented).toBe(true);
      expect(mockProps.handleFileClick).toHaveBeenLastCalledWith(mockFiles[0], expect.any(Object));
      await waitFor(() => expect(rows[1]).toHaveFocus());

      mockProps.handleFileClick.mockClear();
      expect(requestAdjacentFile(mockFiles[0].path, -1)).toBe(mockFiles[2]);
      expect(mockProps.handleFileClick).toHaveBeenCalledOnce();
      expect(mockProps.handleFileClick).toHaveBeenCalledWith(mockFiles[2], expect.any(Object));
    });

    it('routes a request only to the active pane when both panes contain the same paths', async () => {
      const inactiveClick = vi.fn();
      const activeClick = vi.fn();
      render(
        <>
          <section data-active="false" aria-label="Inactive pane">
            <FileGrid
              {...mockProps}
              groupId="inactive"
              viewMode="details"
              handleFileClick={inactiveClick}
            />
          </section>
          <section data-active="true" aria-label="Active pane">
            <FileGrid
              {...mockProps}
              groupId="active"
              viewMode="details"
              handleFileClick={activeClick}
            />
          </section>
          <button>Preview control</button>
        </>,
      );
      expect(
        within(screen.getByRole('region', { name: 'Inactive pane' })).getByRole('row', {
          name: 'document.txt',
        }),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole('region', { name: 'Active pane' })).getByRole('row', {
          name: 'document.txt',
        }),
      ).toBeInTheDocument();
      const preview = screen.getByRole('button', { name: 'Preview control' });
      preview.focus();

      expect(requestAdjacentFile(mockFiles[1].path, 1)).toBe(mockFiles[2]);

      expect(inactiveClick).not.toHaveBeenCalled();
      expect(activeClick).toHaveBeenCalledOnce();
      expect(activeClick).toHaveBeenCalledWith(mockFiles[2], expect.any(Object));
      // Wait for the queued row scroll: requests from preview must preserve its focus.
      await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      expect(preview).toHaveFocus();
    });

    it.each([
      ['ArrowUp', 0],
      ['ArrowDown', 2],
    ] as const)(
      'consumes %s at the details boundary without moving selection or focus',
      (key, index) => {
        render(<FileGrid {...mockProps} viewMode="details" />);
        const row = screen.getByRole('row', { name: mockFiles[index].name });
        row.focus();
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

        fireEvent(row, event);

        expect(event.defaultPrevented).toBe(true);
        expect(mockProps.handleFileClick).not.toHaveBeenCalled();
        expect(row).toHaveFocus();
      },
    );

    it('returns the boundary file for preview requests and stops responding after unmount', () => {
      const { unmount } = render(<FileGrid {...mockProps} viewMode="details" />);
      expect(requestAdjacentFile(mockFiles[0].path, -1)).toBe(mockFiles[0]);
      expect(requestAdjacentFile(mockFiles[2].path, 1)).toBe(mockFiles[2]);
      expect(mockProps.handleFileClick).toHaveBeenNthCalledWith(
        1,
        mockFiles[0],
        expect.any(Object),
      );
      expect(mockProps.handleFileClick).toHaveBeenNthCalledWith(
        2,
        mockFiles[2],
        expect.any(Object),
      );
      unmount();
      mockProps.handleFileClick.mockClear();
      expect(requestAdjacentFile(mockFiles[1].path, 1)).toBeNull();
      expect(mockProps.handleFileClick).not.toHaveBeenCalled();
    });
  });

  describe('View Modes', () => {
    it('renders medium view mode correctly', () => {
      render(<FileGrid {...mockProps} />);

      const grid = document.querySelector('.grid');
      expect(grid).toHaveClass('grid-cols-auto-fill-medium');
    });

    it('renders large view mode correctly', () => {
      const largeProps = { ...mockProps, viewMode: 'large' };
      render(<FileGrid {...largeProps} />);

      const grid = document.querySelector('.grid');
      expect(grid).toHaveClass('grid-cols-auto-fill-large');
    });

    it('renders small view mode correctly', () => {
      const smallProps = { ...mockProps, viewMode: 'small' };
      render(<FileGrid {...smallProps} />);

      const grid = document.querySelector('.grid');
      expect(grid).toHaveClass('grid-cols-auto-fill-small');
    });

    it('renders list view mode correctly', () => {
      const listProps = { ...mockProps, viewMode: 'list' };
      render(<FileGrid {...listProps} />);

      const grid = document.querySelector('.grid');
      expect(grid).toHaveClass('grid-cols-auto-fill-list');
    });

    it('renders details view mode with table structure', () => {
      const detailsProps = { ...mockProps, viewMode: 'details' };
      render(<FileGrid {...detailsProps} />);

      // Details view should show column headers
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Size')).toBeInTheDocument();
      expect(screen.getByText('Type')).toBeInTheDocument();
      expect(screen.getByText('Modified')).toBeInTheDocument();
    });

    it('renders tree view mode', () => {
      const treeProps = { ...mockProps, viewMode: 'tree' };
      render(<FileGrid {...treeProps} />);

      // Tree view should render files in tree structure
      expect(screen.getByText('folder1')).toBeInTheDocument();
      expect(screen.getByText('document.txt')).toBeInTheDocument();
    });
  });

  describe('File Icons and Formatting', () => {
    it('calls getFileIcon for each file', () => {
      render(<FileGrid {...mockProps} />);

      expect(mockProps.getFileIcon).toHaveBeenCalledTimes(3);
      expect(mockProps.getFileIcon).toHaveBeenCalledWith(mockFiles[0]);
      expect(mockProps.getFileIcon).toHaveBeenCalledWith(mockFiles[1]);
      expect(mockProps.getFileIcon).toHaveBeenCalledWith(mockFiles[2]);
    });

    it('formats file sizes correctly', () => {
      const detailsProps = { ...mockProps, viewMode: 'details' };
      render(<FileGrid {...detailsProps} />);

      expect(mockProps.formatFileSize).toHaveBeenCalledWith(1024);
      expect(mockProps.formatFileSize).toHaveBeenCalledWith(2048);
    });

    it('formats folder sizes correctly', () => {
      const detailsProps = { ...mockProps, viewMode: 'details' };
      render(<FileGrid {...detailsProps} />);

      expect(mockProps.formatFolderSize).toHaveBeenCalled();
    });

    it('formats dates correctly', () => {
      const appLocale = vi.spyOn(locale, 'getAppLocale').mockReturnValue('en-US');
      try {
        render(
          <FileGrid
            {...mockProps}
            viewMode="details"
            files={[{ ...mockFiles[1], modified: new Date(2026, 0, 12, 12).getTime() / 1000 }]}
          />,
        );

        expect(
          within(screen.getByRole('row', { name: 'document.txt' })).getByRole('gridcell', {
            name: 'Jan 12',
          }),
        ).toBeVisible();
      } finally {
        appLocale.mockRestore();
      }
    });
  });

  describe('Tree View Functionality', () => {
    it('toggles folder expansion in tree view', async () => {
      const treeProps = { ...mockProps, viewMode: 'tree' };
      render(<FileGrid {...treeProps} />);

      const folderToggle = screen.getAllByRole('button')[0];
      fireEvent.click(folderToggle);

      // Should show loading state
      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has proper cursor styles for interactive elements', () => {
      render(<FileGrid {...mockProps} />);

      const fileElements = document.querySelectorAll('[class*="cursor-pointer"]');
      expect(fileElements.length).toBeGreaterThan(0);
    });

    it('provides hover states', () => {
      render(<FileGrid {...mockProps} />);

      const fileElements = document.querySelectorAll('[class*="hover:bg-xp-surface-light"]');
      expect(fileElements.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('handles files with no file type', () => {
      const filesWithoutType = [
        {
          ...mockFiles[0],
          file_type: '',
        },
      ];
      const propsWithoutType = { ...mockProps, files: filesWithoutType };

      expect(() => render(<FileGrid {...propsWithoutType} />)).not.toThrow();
    });

    it('handles very long file names', () => {
      const filesWithLongNames = [
        {
          ...mockFiles[0],
          name: 'This is a very very very long file name that should be truncated properly',
        },
      ];
      const propsWithLongNames = { ...mockProps, files: filesWithLongNames };

      render(<FileGrid {...propsWithLongNames} />);

      const longNameElement = document.querySelector('.truncate');
      expect(longNameElement).toBeInTheDocument();
    });

    it('handles missing folder size info', () => {
      const propsWithoutSize = {
        ...mockProps,
        getFolderSize: vi.fn(() => null),
        viewMode: 'details',
      };

      render(<FileGrid {...propsWithoutSize} />);

      // In details view, folder size shows a "Calculate" button when there's no cached info
      expect(propsWithoutSize.getFolderSize).toHaveBeenCalled();
    });
  });
});
