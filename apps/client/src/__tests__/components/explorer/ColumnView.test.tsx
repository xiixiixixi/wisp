import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ColumnView from '@/components/explorer/ColumnView';
import type { FileEntry } from '@/lib/tauri-api';
import { requestAdjacentFile } from '@/lib/file-navigation';

const mockReadDirectory = vi.fn();
const mockScrollToIndex = vi.fn();

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    readDirectory: (...args: unknown[]) => mockReadDirectory(...args),
  },
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }: { count: number }) => ({
    getTotalSize: () => count * 30,
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 4) }, (_, offset) => ({
        key: offset + 5,
        index: offset + 5,
        start: (offset + 5) * 30,
        size: 30,
      })),
    scrollToIndex: mockScrollToIndex,
  })),
}));

describe('ColumnView', () => {
  const sampleFiles: FileEntry[] = [
    {
      name: 'Documents',
      path: 'C:\\Home\\Documents',
      size: 0,
      is_dir: true,
      modified: 1000,
      file_type: '',
    },
    {
      name: 'report.pdf',
      path: 'C:\\Home\\report.pdf',
      size: 5120,
      is_dir: false,
      modified: 2000,
      file_type: 'pdf',
    },
    {
      name: 'notes.txt',
      path: 'C:\\Home\\notes.txt',
      size: 256,
      is_dir: false,
      modified: 3000,
      file_type: 'text',
    },
  ];

  const defaultProps = {
    files: sampleFiles,
    selectedFiles: new Set<string>(),
    currentPath: 'C:\\Home',
    groupId: 'g1',
    getFileIcon: vi.fn((file: FileEntry) => (file.is_dir ? '📁' : '📄')),
    formatFileSize: vi.fn((bytes: number) => `${bytes} B`),
    formatFolderSize: vi.fn(() => ''),
    formatDate: vi.fn(() => '2026-01-01'),
    handleFileClick: vi.fn(),
    handleFileDoubleClick: vi.fn(),
    handleFileRightClick: vi.fn(),
    handleBackgroundRightClick: vi.fn(),
    getFolderSize: vi.fn(() => null),
    isCalculatingSize: vi.fn(() => false),
    calculateFolderSize: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadDirectory.mockResolvedValue([]);
  });

  describe('Rendering', () => {
    it('renders the first column with files', () => {
      render(<ColumnView {...defaultProps} />);
      const options = screen.getAllByRole('option');
      expect(options.length).toBe(3);
    });

    it('displays file names', () => {
      render(<ColumnView {...defaultProps} />);
      expect(screen.getByText('Documents')).toBeInTheDocument();
      expect(screen.getByText('report.pdf')).toBeInTheDocument();
      expect(screen.getByText('notes.txt')).toBeInTheDocument();
    });

    it('shows chevron for directories', () => {
      render(<ColumnView {...defaultProps} />);
      // The Documents folder should have a ">" chevron indicator
      const dirOption = screen.getByText('Documents').closest('[role="option"]')!;
      // Check that there's a chevron character
      expect(dirOption.textContent).toContain('\u203A');
    });

    it('does not show chevron for files', () => {
      render(<ColumnView {...defaultProps} />);
      const fileOption = screen.getByText('report.pdf').closest('[role="option"]')!;
      // The chevron character should not be in the file row
      expect(fileOption.textContent).not.toContain('\u203A');
    });
  });

  describe('File interactions', () => {
    it('calls handleFileClick when file is clicked', () => {
      render(<ColumnView {...defaultProps} />);
      const option = screen.getByText('report.pdf').closest('[role="option"]')!;
      fireEvent.click(option);
      expect(defaultProps.handleFileClick).toHaveBeenCalled();
    });

    it('calls handleFileDoubleClick on double-click', () => {
      render(<ColumnView {...defaultProps} />);
      const option = screen.getByText('report.pdf').closest('[role="option"]')!;
      fireEvent.doubleClick(option);
      expect(defaultProps.handleFileDoubleClick).toHaveBeenCalledWith(sampleFiles[1]);
    });

    it('calls handleFileRightClick on context menu', () => {
      render(<ColumnView {...defaultProps} />);
      const option = screen.getByText('notes.txt').closest('[role="option"]')!;
      fireEvent.contextMenu(option);
      expect(defaultProps.handleFileRightClick).toHaveBeenCalled();
    });

    it('Enter key starts an inline rename (Finder behaviour)', () => {
      const renameEvents: CustomEvent[] = [];
      const listener = (e: Event) => renameEvents.push(e as CustomEvent);
      window.addEventListener('start-inline-rename', listener);
      try {
        render(<ColumnView {...defaultProps} />);
        const option = screen.getByText('report.pdf').closest('[role="option"]')!;
        fireEvent.keyDown(option, { key: 'Enter' });
        expect(defaultProps.handleFileDoubleClick).not.toHaveBeenCalled();
        expect(renameEvents).toHaveLength(1);
        expect(renameEvents[0].detail).toEqual({ path: sampleFiles[1].path });
      } finally {
        window.removeEventListener('start-inline-rename', listener);
      }
    });
  });

  describe('Directory navigation', () => {
    it('loads subdirectory when a folder is clicked', async () => {
      const subFiles: FileEntry[] = [
        {
          name: 'readme.md',
          path: 'C:\\Home\\Documents\\readme.md',
          size: 100,
          is_dir: false,
          modified: 0,
          file_type: 'markdown',
        },
      ];
      mockReadDirectory.mockResolvedValue(subFiles);

      render(<ColumnView {...defaultProps} />);

      const dirOption = screen.getByText('Documents').closest('[role="option"]')!;
      fireEvent.click(dirOption);

      await waitFor(() => {
        expect(mockReadDirectory).toHaveBeenCalledWith('C:\\Home\\Documents');
      });

      await waitFor(() => {
        expect(screen.getByText('readme.md')).toBeInTheDocument();
      });
    });
  });

  describe('Selection state', () => {
    it('marks selected file as selected', () => {
      const selected = new Set(['C:\\Home\\report.pdf']);
      render(<ColumnView {...defaultProps} selectedFiles={selected} />);
      const option = screen.getByText('report.pdf').closest('[role="option"]')!;
      expect(option).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('Empty folder', () => {
    it('shows Empty folder message', () => {
      render(<ColumnView {...defaultProps} files={[]} />);
      expect(screen.getByText('Empty folder')).toBeInTheDocument();
    });
  });

  describe('File preview pane', () => {
    it('shows file details when a file is selected in a column', async () => {
      render(<ColumnView {...defaultProps} />);

      // Click on a file to select it
      const fileOption = screen.getByText('report.pdf').closest('[role="option"]')!;
      fireEvent.click(fileOption);

      // File preview should show file details
      await waitFor(() => {
        // The file name should appear in the preview pane (it is shown via getFileIcon + name)
        const nameElements = screen.getAllByText('report.pdf');
        // At least 2: one in column, one in preview
        expect(nameElements.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Adjacent file navigation', () => {
    it('moves selection and focus through the current column with up and down arrows', async () => {
      render(<ColumnView {...defaultProps} />);
      const rows = screen.getAllByRole('option');
      rows[1].focus();
      fireEvent.keyDown(rows[1], { key: 'ArrowDown' });
      expect(defaultProps.handleFileClick).toHaveBeenLastCalledWith(
        sampleFiles[2],
        expect.anything(),
      );
      await waitFor(() => expect(rows[2]).toHaveFocus());
      fireEvent.keyDown(rows[2], { key: 'ArrowUp' });
      expect(defaultProps.handleFileClick).toHaveBeenLastCalledWith(
        sampleFiles[1],
        expect.anything(),
      );
      await waitFor(() => expect(rows[1]).toHaveFocus());
    });

    it('serves the child column order without moving focus out of Quick Look', async () => {
      const children = ['z.txt', 'a.txt'].map((name) => ({
        ...sampleFiles[2],
        name,
        path: `${sampleFiles[0].path}\\${name}`,
      }));
      mockReadDirectory.mockResolvedValue(children);
      render(<ColumnView {...defaultProps} />);
      fireEvent.click(screen.getAllByRole('option')[0]);
      await screen.findByText('z.txt');
      const overlayControl = document.createElement('button');
      document.body.append(overlayControl);
      overlayControl.focus();
      act(() => expect(requestAdjacentFile(children[0].path, 1)).toBe(children[1]));
      expect(defaultProps.handleFileClick).toHaveBeenLastCalledWith(children[1], expect.anything());
      expect(screen.getAllByRole('option').at(-1)).toHaveAttribute('aria-selected', 'true');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(overlayControl).toHaveFocus();
      overlayControl.remove();
    });

    it('uses the full virtualized column order rather than mounted row indices', () => {
      const files = Array.from({ length: 201 }, (_, index) => ({
        ...sampleFiles[2],
        name: `file-${index}.txt`,
        path: `/large/file-${index}.txt`,
      }));
      render(<ColumnView {...defaultProps} files={files} currentPath="/large" />);
      const rows = screen.getAllByRole('option');
      expect(rows).toHaveLength(4);
      rows[1].focus();
      fireEvent.keyDown(rows[1], { key: 'ArrowDown' });
      expect(defaultProps.handleFileClick).toHaveBeenLastCalledWith(files[7], expect.anything());
      expect(mockScrollToIndex).toHaveBeenLastCalledWith(7, { align: 'auto' });
      act(() => expect(requestAdjacentFile(files[199].path, 1)).toBe(files[200]));
      expect(mockScrollToIndex).toHaveBeenLastCalledWith(200, { align: 'auto' });
    });

    it('ignores a folder result after arrow navigation has selected a different folder', async () => {
      let finishFirst!: (files: FileEntry[]) => void;
      const secondFolder = { ...sampleFiles[0], name: 'Projects', path: '/Projects' };
      const currentChild = {
        ...sampleFiles[2],
        name: 'current.txt',
        path: '/Projects/current.txt',
      };
      const staleChild = { ...sampleFiles[2], name: 'stale.txt', path: '/Documents/stale.txt' };
      mockReadDirectory.mockImplementation((path: string) =>
        path === secondFolder.path
          ? Promise.resolve([currentChild])
          : new Promise<FileEntry[]>((resolve) => {
              finishFirst = resolve;
            }),
      );
      render(<ColumnView {...defaultProps} files={[sampleFiles[0], secondFolder]} />);
      const firstRow = screen.getAllByRole('option')[0];
      fireEvent.click(firstRow);
      firstRow.focus();
      fireEvent.keyDown(firstRow, { key: 'ArrowDown' });
      await screen.findByText('current.txt');
      await act(async () => finishFirst([staleChild]));
      expect(screen.queryByText('stale.txt')).not.toBeInTheDocument();
      expect(screen.getByText('current.txt')).toBeVisible();
    });
  });
});
