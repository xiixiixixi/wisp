import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import GalleryView from '@/components/explorer/GalleryView';
import type { FileEntry } from '@/lib/tauri-api';
import { requestAdjacentFile } from '@/lib/file-navigation';

vi.mock('@/lib/utils', () => ({ formatDateTimeShort: () => '2026-01-01' }));
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 68,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: index,
        index,
        start: index * 68,
        size: 68,
      })),
    scrollToIndex: vi.fn(),
  }),
}));

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    getAIIndexEntry: vi.fn(() => Promise.resolve(null)),
    triggerAIIndexing: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@/hooks/use-draggable', () => ({
  useDraggable: vi.fn(() => ({})),
}));

vi.mock('@/hooks/use-droppable', async () => {
  const { useRef } = await import('react');
  return { useDroppable: () => useRef(null) };
});

vi.mock('@/hooks/use-thumbnail-cache', () => ({
  useThumbnailCache: vi.fn(() => ({
    getThumbnailUrl: (path: string) => `thumb://${path}`,
    preloadThumbnails: vi.fn(),
  })),
}));

vi.mock('@/components/explorer/FileGridHelpers', () => ({
  isImageFile: (file: FileEntry) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '');
  },
}));

describe('GalleryView', () => {
  const imageFiles: FileEntry[] = [
    {
      name: 'photo1.jpg',
      path: 'C:\\Photos\\photo1.jpg',
      size: 10240,
      is_dir: false,
      modified: 1000,
      file_type: 'image',
    },
    {
      name: 'photo2.png',
      path: 'C:\\Photos\\photo2.png',
      size: 20480,
      is_dir: false,
      modified: 2000,
      file_type: 'image',
    },
  ];

  const mixedFiles: FileEntry[] = [
    ...imageFiles,
    {
      name: 'document.pdf',
      path: 'C:\\Photos\\document.pdf',
      size: 5120,
      is_dir: false,
      modified: 3000,
      file_type: 'pdf',
    },
    {
      name: 'folder',
      path: 'C:\\Photos\\folder',
      size: 0,
      is_dir: true,
      modified: 4000,
      file_type: '',
    },
  ];

  const defaultProps = {
    files: mixedFiles,
    selectedFiles: new Set<string>(),
    currentPath: 'C:\\Photos',
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
  });

  describe('Adjacent file navigation', () => {
    it('synchronizes selection, focus and the large preview for both vertical arrows', async () => {
      render(<GalleryView {...defaultProps} />);
      const rows = screen.getAllByRole('option');
      rows[0].focus();
      fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
      expect(defaultProps.handleFileClick).toHaveBeenLastCalledWith(
        mixedFiles[1],
        expect.anything(),
      );
      expect(screen.getByLabelText('Preview of photo2.png')).toBeVisible();
      await waitFor(() => expect(rows[1]).toHaveFocus());
      fireEvent.keyDown(rows[1], { key: 'ArrowUp' });
      expect(defaultProps.handleFileClick).toHaveBeenLastCalledWith(
        mixedFiles[0],
        expect.anything(),
      );
      expect(screen.getByLabelText('Preview of photo1.jpg')).toBeVisible();
      await waitFor(() => expect(rows[0]).toHaveFocus());
    });

    it('handles each horizontal arrow once and leaves arrows outside the view alone', async () => {
      render(<GalleryView {...defaultProps} />);
      const rows = screen.getAllByRole('option');
      rows[0].focus();
      fireEvent.keyDown(rows[0], { key: 'ArrowRight' });
      expect(defaultProps.handleFileClick).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(rows[1]).toHaveFocus());
      fireEvent.keyDown(rows[1], { key: 'ArrowLeft' });
      expect(defaultProps.handleFileClick).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(rows[0]).toHaveFocus());
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
      expect(defaultProps.handleFileClick).toHaveBeenCalledTimes(2);
    });

    it('updates the gallery preview through adjacent requests while retaining overlay focus', async () => {
      render(<GalleryView {...defaultProps} />);
      const overlayControl = document.createElement('button');
      document.body.append(overlayControl);
      overlayControl.focus();
      act(() => expect(requestAdjacentFile(mixedFiles[0].path, 1)).toBe(mixedFiles[1]));
      expect(defaultProps.handleFileClick).toHaveBeenLastCalledWith(
        mixedFiles[1],
        expect.anything(),
      );
      expect(screen.getByLabelText('Preview of photo2.png')).toBeVisible();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(overlayControl).toHaveFocus();
      overlayControl.remove();
    });

    it('opens Quick Look once for the focused thumbnail using Space', () => {
      const onQuickLook = vi.fn();
      render(<GalleryView {...defaultProps} onQuickLook={onQuickLook} />);
      const row = screen.getAllByRole('option')[2];
      row.focus();
      fireEvent.keyDown(row, { key: ' ' });
      expect(onQuickLook).toHaveBeenCalledOnce();
      expect(onQuickLook).toHaveBeenCalledWith(mixedFiles[2]);
    });
  });

  describe('Rendering', () => {
    it('renders Gallery view container', () => {
      render(<GalleryView {...defaultProps} />);
      expect(screen.getByLabelText('Gallery view')).toBeInTheDocument();
    });

    it('renders filmstrip thumbnails for all files', () => {
      render(<GalleryView {...defaultProps} />);
      const options = screen.getAllByRole('option');
      expect(options.length).toBe(4); // 4 files in filmstrip
    });

    it('shows file names as titles on filmstrip items', () => {
      render(<GalleryView {...defaultProps} />);
      expect(screen.getByTitle('photo1.jpg')).toBeInTheDocument();
      expect(screen.getByTitle('photo2.png')).toBeInTheDocument();
      expect(screen.getByTitle('document.pdf')).toBeInTheDocument();
    });
  });

  describe('Preview area', () => {
    it('auto-focuses first file by default', () => {
      render(<GalleryView {...defaultProps} />);
      // The first file's name appears in the info overlay
      expect(screen.getByText('photo1.jpg')).toBeInTheDocument();
    });

    it('shows selected file in preview when one is selected', () => {
      const selected = new Set(['C:\\Photos\\photo2.png']);
      render(<GalleryView {...defaultProps} selectedFiles={selected} />);
      // File info overlay should show selected file's name
      expect(screen.getByText('photo2.png')).toBeInTheDocument();
    });

    it('shows No files message when file list is empty', () => {
      render(<GalleryView {...defaultProps} files={[]} />);
      expect(screen.getByText('No files')).toBeInTheDocument();
    });

    it('shows file size for non-directory files', () => {
      render(<GalleryView {...defaultProps} />);
      // formatFileSize is called for the display file
      expect(defaultProps.formatFileSize).toHaveBeenCalled();
    });

    it('shows Folder text for directory files', () => {
      render(
        <GalleryView
          {...defaultProps}
          files={[
            {
              name: 'myfolder',
              path: 'C:\\Photos\\myfolder',
              size: 0,
              is_dir: true,
              modified: 0,
              file_type: '',
            },
          ]}
        />,
      );
      // "Folder" appears in both the preview area and the info overlay
      const folderTexts = screen.getAllByText('Folder');
      expect(folderTexts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Filmstrip interactions', () => {
    it('calls handleFileClick when filmstrip item is clicked', () => {
      render(<GalleryView {...defaultProps} />);
      const items = screen.getAllByRole('option');
      fireEvent.click(items[1]);
      expect(defaultProps.handleFileClick).toHaveBeenCalled();
    });

    it('calls handleFileDoubleClick on double-click', () => {
      render(<GalleryView {...defaultProps} />);
      const items = screen.getAllByRole('option');
      fireEvent.doubleClick(items[0]);
      expect(defaultProps.handleFileDoubleClick).toHaveBeenCalledWith(mixedFiles[0]);
    });

    it('calls handleFileRightClick on context menu', () => {
      render(<GalleryView {...defaultProps} />);
      const items = screen.getAllByRole('option');
      fireEvent.contextMenu(items[0]);
      expect(defaultProps.handleFileRightClick).toHaveBeenCalled();
    });
  });

  describe('Selection', () => {
    it('marks selected files as selected in filmstrip', () => {
      const selected = new Set(['C:\\Photos\\photo1.jpg']);
      render(<GalleryView {...defaultProps} selectedFiles={selected} />);
      const items = screen.getAllByRole('option');
      expect(items[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('shows aria labels for files and folders', () => {
      render(<GalleryView {...defaultProps} />);
      expect(screen.getByLabelText('photo1.jpg, file')).toBeInTheDocument();
      expect(screen.getByLabelText('folder, folder')).toBeInTheDocument();
    });
  });
});
