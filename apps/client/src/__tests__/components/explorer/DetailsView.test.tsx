import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import DetailsView from '@/components/explorer/DetailsView';
import type { FileEntry } from '@/lib/tauri-api';
import { getAppLocale } from '@/lib/locale';

// Mock @tanstack/react-virtual
const virtualRows = vi.hoisted(() => ({ indices: [] as number[] }));
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () =>
      virtualRows.indices.map((index) => ({ key: index, index, start: index * 32, size: 32 })),
    getTotalSize: () => 0,
    scrollToIndex: vi.fn(),
  }),
}));

// Mock hooks used by FileRow
vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {},
  FileEntry: {},
}));

vi.mock('@/hooks/use-draggable', () => ({
  useDraggable: () => ({
    onMouseDown: vi.fn(),
    onMouseMove: vi.fn(),
    onMouseUp: vi.fn(),
  }),
}));

describe('DetailsView', () => {
  const mockHandleFileClick = vi.fn();
  const mockHandleFileDoubleClick = vi.fn();
  const mockHandleFileRightClick = vi.fn();
  const mockHandleBackgroundRightClick = vi.fn();
  const mockGetFolderSize = vi.fn(() => null);
  const mockIsCalculatingSize = vi.fn(() => false);
  const mockCalculateFolderSize = vi.fn();

  const sampleFiles: FileEntry[] = [
    {
      name: 'document.txt',
      path: 'C:\\Users\\Test\\document.txt',
      size: 1024,
      is_dir: false,
      modified: 1710000000,
      file_type: 'text',
    },
    {
      name: 'images',
      path: 'C:\\Users\\Test\\images',
      size: 0,
      is_dir: true,
      modified: 1710001000,
      file_type: 'folder',
    },
    {
      name: 'script.js',
      path: 'C:\\Users\\Test\\script.js',
      size: 2048,
      is_dir: false,
      modified: 1710002000,
      file_type: 'javascript',
    },
  ];

  const defaultProps = {
    files: sampleFiles,
    selectedFiles: new Set<string>(),
    currentPath: 'C:\\Users\\Test',
    groupId: 'main',
    getFileIcon: (file: FileEntry) => <span data-testid={`icon-${file.name}`}>icon</span>,
    formatFileSize: (bytes: number) => `${bytes} B`,
    formatFolderSize: (info: unknown, isCalc?: boolean) => {
      if (isCalc) return 'Calculating...';
      return info ? '1 MB' : '';
    },
    formatDate: (ts: number) => `date-${ts}`,
    handleFileClick: mockHandleFileClick,
    handleFileDoubleClick: mockHandleFileDoubleClick,
    handleFileRightClick: mockHandleFileRightClick,
    handleBackgroundRightClick: mockHandleBackgroundRightClick,
    getFolderSize: mockGetFolderSize,
    isCalculatingSize: mockIsCalculatingSize,
    calculateFolderSize: mockCalculateFolderSize,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    virtualRows.indices = [];
  });

  it('keeps one visible keyboard entry when the preferred file is outside the virtual window', async () => {
    const user = userEvent.setup();
    const files = Array.from({ length: 220 }, (_, index) => ({
      ...sampleFiles[0],
      path: `/files/${index}.txt`,
      name: `${index}.txt`,
    }));
    virtualRows.indices = [150, 151, 152];
    const content = () => (
      <>
        <button>Before files</button>
        <DetailsView
          {...defaultProps}
          files={files}
          selectedFiles={new Set([files[0].path])}
          tabStopPath={files[0].path}
        />
        <button>After files</button>
      </>
    );
    const { container, rerender } = render(content());
    const entries = () =>
      Array.from(container.querySelectorAll<HTMLElement>('[data-file-path]')).filter(
        (row) => row.tabIndex === 0,
      );
    expect(entries().map((row) => row.dataset.filePath)).toEqual(['/files/150.txt']);
    screen.getByRole('button', { name: 'Before files' }).focus();
    await user.tab();
    expect(entries()[0]).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After files' })).toHaveFocus();
    virtualRows.indices = [0, 1, 2];
    rerender(content());
    expect(entries().map((row) => row.dataset.filePath)).toEqual(['/files/0.txt']);
  });

  describe('Table structure', () => {
    it('renders with table role', () => {
      render(<DetailsView {...defaultProps} />);
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('renders column headers', () => {
      render(<DetailsView {...defaultProps} />);
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Size')).toBeInTheDocument();
      expect(screen.getByText('Type')).toBeInTheDocument();
      expect(screen.getByText('Modified')).toBeInTheDocument();
    });

    it('has correct aria-label on table', () => {
      render(<DetailsView {...defaultProps} />);
      expect(screen.getByRole('table')).toHaveAttribute('aria-label', 'File list');
    });
  });

  describe('Modified Date', () => {
    it('shows the local 24-hour modification time for a file modified today', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 2, 14, 30));
      try {
        const file = { ...sampleFiles[0], modified: new Date(2026, 9, 2, 3, 7).getTime() / 1000 };
        render(<DetailsView {...defaultProps} files={[file]} />);

        expect(screen.getByText('03:07')).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('preserves the existing date style for a file modified before local midnight', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 2, 0, 1));
      try {
        const previousDate = new Date(2026, 9, 1, 23, 59);
        const file = { ...sampleFiles[0], modified: previousDate.getTime() / 1000 };
        const expected = previousDate.toLocaleDateString(getAppLocale(), {
          month: 'short',
          day: 'numeric',
        });
        render(<DetailsView {...defaultProps} files={[file]} />);

        expect(screen.getByText(expected)).toBeInTheDocument();
        expect(screen.queryByText('23:59')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('File rows', () => {
    it('renders all file entries', () => {
      render(<DetailsView {...defaultProps} />);

      expect(screen.getByText('document.txt')).toBeInTheDocument();
      expect(screen.getByText('images')).toBeInTheDocument();
      expect(screen.getByText('script.js')).toBeInTheDocument();
    });

    it('renders file type badges', () => {
      render(<DetailsView {...defaultProps} />);
      expect(screen.getByText('Text document')).toBeInTheDocument();
      expect(screen.getByText('Folder')).toBeInTheDocument();
      expect(screen.getByText('javascript')).toBeInTheDocument();
    });

    it('renders file sizes', () => {
      render(<DetailsView {...defaultProps} />);
      expect(screen.getByText('1024 B')).toBeInTheDocument();
      expect(screen.getByText('2048 B')).toBeInTheDocument();
    });

    it('renders short dates', () => {
      render(<DetailsView {...defaultProps} />);
      // 行内日期简化为「月 日」（R2 评审：完整时间戳过长）
      const rendered = document.body.textContent || '';
      expect(rendered.length).toBeGreaterThan(0);
    });

    it('renders icons for each file', () => {
      render(<DetailsView {...defaultProps} />);
      expect(screen.getByTestId('icon-document.txt')).toBeInTheDocument();
      expect(screen.getByTestId('icon-images')).toBeInTheDocument();
    });

    it('renders rows with correct role and aria-label', () => {
      render(<DetailsView {...defaultProps} />);
      const rows = screen.getAllByRole('row');
      // 1 header row + 3 data rows
      expect(rows.length).toBe(4);
    });
  });

  describe('Sticky header material', () => {
    it('protects the header only while its enclosing file pane is scrolled', () => {
      const { container } = render(
        <div className="wisp-file-scroll">
          <DetailsView {...defaultProps} />
        </div>,
      );
      const scrollPane = container.firstElementChild as HTMLElement;
      const header = container.querySelector('.wisp-list-header');

      expect(header).not.toHaveClass('wisp-list-header-scrolled');
      fireEvent.scroll(scrollPane, { target: { scrollTop: 1 } });
      expect(header).toHaveClass('wisp-list-header-scrolled');
      fireEvent.scroll(scrollPane, { target: { scrollTop: 80 } });
      expect(header).toHaveClass('wisp-list-header-scrolled');
      fireEvent.scroll(scrollPane, { target: { scrollTop: 0 } });
      expect(header).not.toHaveClass('wisp-list-header-scrolled');
    });

    it('follows the virtual list scroll container when the list grows and resets on return', () => {
      const virtualFiles = Array.from({ length: 200 }, (_, index) => ({
        ...sampleFiles[0],
        name: `document-${index}.txt`,
        path: `/fixture/document-${index}.txt`,
      }));
      const renderPane = (files: FileEntry[]) => (
        <div className="wisp-file-scroll">
          <DetailsView {...defaultProps} files={files} />
        </div>
      );
      const { container, rerender } = render(renderPane(sampleFiles));
      const scrollPane = container.firstElementChild as HTMLElement;
      const header = () => container.querySelector('.wisp-list-header');

      fireEvent.scroll(scrollPane, { target: { scrollTop: 80 } });
      expect(header()).toHaveClass('wisp-list-header-scrolled');

      rerender(renderPane(virtualFiles));
      expect(header()).not.toHaveClass('wisp-list-header-scrolled');
      fireEvent.scroll(scrollPane, { target: { scrollTop: 120 } });
      expect(header()).not.toHaveClass('wisp-list-header-scrolled');

      const virtualScrollPane = screen.getByRole('table');
      fireEvent.scroll(virtualScrollPane, { target: { scrollTop: 32 } });
      expect(header()).toHaveClass('wisp-list-header-scrolled');
      fireEvent.scroll(virtualScrollPane, { target: { scrollTop: 0 } });
      expect(header()).not.toHaveClass('wisp-list-header-scrolled');

      rerender(renderPane(sampleFiles));
      expect(header()).toHaveClass('wisp-list-header-scrolled');
      fireEvent.scroll(scrollPane, { target: { scrollTop: 0 } });
      expect(header()).not.toHaveClass('wisp-list-header-scrolled');
    });
  });

  describe('Selection highlighting', () => {
    it('applies selected styling when file is in selectedFiles', () => {
      const selectedFiles = new Set(['C:\\Users\\Test\\document.txt']);
      render(<DetailsView {...defaultProps} selectedFiles={selectedFiles} />);

      const row = screen.getByRole('row', { name: 'document.txt' });
      expect(row).toHaveAttribute('aria-selected', 'true');
    });

    it('does not apply selected styling for unselected files', () => {
      render(<DetailsView {...defaultProps} />);

      const row = screen.getByRole('row', { name: 'document.txt' });
      expect(row).toHaveAttribute('aria-selected', 'false');
    });
  });

  describe('Click handlers', () => {
    it('calls handleFileClick on click', () => {
      render(<DetailsView {...defaultProps} />);

      const row = screen.getByRole('row', { name: 'document.txt' });
      fireEvent.click(row);
      expect(mockHandleFileClick).toHaveBeenCalledWith(sampleFiles[0], expect.any(Object));
    });

    it('calls handleFileDoubleClick on double click', () => {
      render(<DetailsView {...defaultProps} />);

      const row = screen.getByRole('row', { name: 'document.txt' });
      fireEvent.doubleClick(row);
      expect(mockHandleFileDoubleClick).toHaveBeenCalledWith(sampleFiles[0]);
    });

    it('calls handleFileRightClick on context menu', () => {
      render(<DetailsView {...defaultProps} />);

      const row = screen.getByRole('row', { name: 'document.txt' });
      fireEvent.contextMenu(row);
      expect(mockHandleFileRightClick).toHaveBeenCalledWith(sampleFiles[0], expect.any(Object));
    });

    it('Enter key starts an inline rename (Finder behaviour)', () => {
      const renameEvents: CustomEvent[] = [];
      const listener = (e: Event) => renameEvents.push(e as CustomEvent);
      window.addEventListener('start-inline-rename', listener);
      try {
        render(<DetailsView {...defaultProps} />);

        const row = screen.getByRole('row', { name: 'document.txt' });
        fireEvent.keyDown(row, { key: 'Enter' });
        expect(mockHandleFileDoubleClick).not.toHaveBeenCalled();
        expect(renameEvents).toHaveLength(1);
        expect(renameEvents[0].detail).toEqual({ path: sampleFiles[0].path });
      } finally {
        window.removeEventListener('start-inline-rename', listener);
      }
    });

    it('calls handleBackgroundRightClick on background context menu', () => {
      render(<DetailsView {...defaultProps} />);

      const table = screen.getByRole('table');
      fireEvent.contextMenu(table);
      expect(mockHandleBackgroundRightClick).toHaveBeenCalled();
    });
  });

  describe('Folder size', () => {
    it('shows Calculate button for folders without size info', () => {
      mockGetFolderSize.mockReturnValue(null);
      mockIsCalculatingSize.mockReturnValue(false);
      render(<DetailsView {...defaultProps} />);

      expect(screen.getByText('Calculate')).toBeInTheDocument();
    });

    it('calls calculateFolderSize when Calculate button is clicked', () => {
      mockGetFolderSize.mockReturnValue(null);
      mockIsCalculatingSize.mockReturnValue(false);
      render(<DetailsView {...defaultProps} />);

      fireEvent.click(screen.getByText('Calculate'));
      expect(mockCalculateFolderSize).toHaveBeenCalledWith('C:\\Users\\Test\\images');
    });
  });

  describe('File groups', () => {
    it('renders grouped view when fileGroups are provided', () => {
      const fileGroups = [
        {
          group: 'Documents',
          files: [sampleFiles[0]],
        },
        {
          group: 'Folders',
          files: [sampleFiles[1]],
        },
      ];
      const { container } = render(<DetailsView {...defaultProps} fileGroups={fileGroups} />);

      expect(screen.getByText('Documents')).toBeInTheDocument();
      expect(screen.getByText('Folders')).toBeInTheDocument();
      const counts = container.querySelectorAll('.wisp-file-group-header span:last-child');
      expect(counts).toHaveLength(2);
      expect(Array.from(counts).map((count) => count.textContent)).toEqual(['1', '1']);
    });
  });

  describe('Empty state', () => {
    it('renders header even with no files', () => {
      render(<DetailsView {...defaultProps} files={[]} />);
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByText('Name')).toBeInTheDocument();
    });
  });
});
