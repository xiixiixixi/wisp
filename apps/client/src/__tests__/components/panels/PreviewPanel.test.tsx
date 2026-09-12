import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PreviewPanel from '@/components/panels/PreviewPanel';
import { FileEntry, FolderSizeInfo } from '@/lib/tauri-api';
import i18n from '@/i18n';
import { requestAdjacentFile } from '@/lib/file-navigation';

vi.mock('@/lib/file-navigation', () => ({
  requestAdjacentFile: vi.fn(() => null),
}));

vi.mock('@/lib/transport', () => ({
  isTauri: () => false,
  convertAssetUrl: (path: string) => path,
}));

// Mock preview-factory
vi.mock('@/lib/preview-factory', () => ({
  defaultPreviewFactory: {
    canPreview: vi.fn(() => false),
    getFileType: vi.fn((file: { name: string; is_dir: boolean }) => {
      if (file.is_dir) return 'folder';
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const map: Record<string, string> = {
        jpg: 'image',
        png: 'image',
        gif: 'image',
        txt: 'text',
        md: 'markdown',
        json: 'json',
        pdf: 'pdf',
        doc: 'document',
        mp4: 'video',
        mp3: 'audio',
        zip: 'archive',
      };
      return map[ext] || 'unknown';
    }),
    getPreviewComponent: vi.fn(() => Promise.resolve(null)),
  },
  PreviewProps: {},
  PreviewType: {},
}));

describe('PreviewPanel', () => {
  const expandProperties = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Show file properties' }));
  };

  const mockFile: FileEntry = {
    name: 'document.txt',
    path: 'C:\\Users\\Test\\document.txt',
    size: 1024,
    is_dir: false,
    modified: Date.now(),
    file_type: 'text',
  };

  const mockFolder: FileEntry = {
    name: 'MyFolder',
    path: 'C:\\Users\\Test\\MyFolder',
    size: 0,
    is_dir: true,
    modified: Date.now(),
    file_type: 'folder',
  };

  const mockProps = {
    selectedFile: mockFile,
    formatFileSize: vi.fn((bytes: number) => `${bytes} B`),
    formatDate: vi.fn((_timestamp: number) => '2024-01-01 12:00'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requestAdjacentFile).mockReturnValue(null);
  });

  describe('Adjacent File Navigation', () => {
    const getPreview = () => screen.getByRole('region', { name: 'Preview of document.txt' });
    const keyDown = (target: Element, options: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
        ...options,
      });
      fireEvent(target, event);
      return event;
    };

    it('captures read-only code arrows before its cursor keymap without moving focus', () => {
      render(<PreviewPanel {...mockProps} />);
      const wrapper = document.createElement('div');
      wrapper.dataset.previewReadonly = 'true';
      const editor = document.createElement('div');
      editor.className = 'cm-editor';
      const content = document.createElement('div');
      content.setAttribute('role', 'textbox');
      content.contentEditable = 'false';
      content.tabIndex = 0;
      const cursorKeymap = vi.fn();
      content.addEventListener('keydown', cursorKeymap);
      editor.append(content);
      wrapper.append(editor);
      getPreview().append(wrapper);
      content.focus();
      vi.mocked(requestAdjacentFile).mockReturnValue(mockFile);

      expect(keyDown(content).defaultPrevented).toBe(true);
      expect(requestAdjacentFile).toHaveBeenLastCalledWith(mockFile.path, 1);
      expect(keyDown(content, { key: 'ArrowUp' }).defaultPrevented).toBe(true);
      expect(requestAdjacentFile).toHaveBeenLastCalledWith(mockFile.path, -1);
      expect(cursorKeymap).not.toHaveBeenCalled();
      expect(content).toHaveFocus();
    });

    it('leaves arrows alone when the current file is absent from the active file list', () => {
      render(<PreviewPanel {...mockProps} />);
      const button = screen.getByRole('button', { name: 'Show file properties' });
      expect(keyDown(button).defaultPrevented).toBe(false);
      expect(requestAdjacentFile).toHaveBeenCalledWith(mockFile.path, 1);
    });

    it('protects an editing or dirty preview even when file properties have focus', () => {
      render(<PreviewPanel {...mockProps} />);
      const editing = document.createElement('div');
      editing.dataset.previewEditing = 'true';
      getPreview().append(editing);
      const properties = screen.getByRole('button', { name: 'Show file properties' });
      properties.focus();
      vi.mocked(requestAdjacentFile).mockReturnValue(mockFile);

      expect(keyDown(properties).defaultPrevented).toBe(false);
      expect(requestAdjacentFile).not.toHaveBeenCalled();
      editing.remove();
      expect(keyDown(properties).defaultPrevented).toBe(true);
    });

    it.each([
      ['input', {}],
      ['textarea', {}],
      ['select', {}],
      ['div', { contenteditable: 'true' }],
      ['div', { class: 'xterm' }],
      ['div', { role: 'textbox' }],
      ['div', { role: 'combobox' }],
      ['div', { role: 'listbox' }],
      ['div', { role: 'slider' }],
      ['div', { role: 'tablist' }],
    ])('preserves %s controls with attributes %j', (tag, attributes) => {
      render(<PreviewPanel {...mockProps} />);
      const control = document.createElement(tag);
      for (const [name, value] of Object.entries(attributes)) control.setAttribute(name, value);
      getPreview().append(control);
      vi.mocked(requestAdjacentFile).mockReturnValue(mockFile);

      expect(keyDown(control).defaultPrevented).toBe(false);
      expect(requestAdjacentFile).not.toHaveBeenCalled();
    });

    it('preserves selection modifiers, composition, and non-vertical keys', () => {
      render(<PreviewPanel {...mockProps} />);
      const button = screen.getByRole('button', { name: 'Show file properties' });
      vi.mocked(requestAdjacentFile).mockReturnValue(mockFile);
      for (const options of [
        { shiftKey: true },
        { metaKey: true },
        { ctrlKey: true },
        { altKey: true },
        { isComposing: true },
        { key: 'ArrowLeft' },
      ]) {
        expect(keyDown(button, options).defaultPrevented).toBe(false);
      }
      expect(requestAdjacentFile).not.toHaveBeenCalled();
    });

    it.each(['dialog', 'alertdialog', 'menu'])('does not navigate behind an open %s', (role) => {
      render(
        <>
          <PreviewPanel {...mockProps} />
          <div role={role} aria-modal={role === 'menu' ? undefined : true} />
        </>,
      );
      vi.mocked(requestAdjacentFile).mockReturnValue(mockFile);
      const button = screen.getByRole('button', { name: 'Show file properties' });
      expect(keyDown(button).defaultPrevented).toBe(false);
      expect(requestAdjacentFile).not.toHaveBeenCalled();
    });

    it('does not take arrows from a control outside this preview', () => {
      render(
        <>
          <PreviewPanel {...mockProps} />
          <button type="button">Outside</button>
        </>,
      );
      const outside = screen.getByRole('button', { name: 'Outside' });
      outside.focus();
      vi.mocked(requestAdjacentFile).mockReturnValue(mockFile);
      expect(keyDown(outside).defaultPrevented).toBe(false);
      expect(keyDown(document.body).defaultPrevented).toBe(false);
      expect(requestAdjacentFile).not.toHaveBeenCalled();
    });

    it('continues from body focus after a preview unmount, and removes the listener on close', () => {
      const { unmount } = render(<PreviewPanel {...mockProps} />);
      vi.mocked(requestAdjacentFile).mockReturnValue(mockFile);
      expect(document.body).toHaveFocus();
      expect(keyDown(document.body).defaultPrevented).toBe(true);
      expect(requestAdjacentFile).toHaveBeenCalledTimes(1);
      unmount();
      expect(keyDown(document.body).defaultPrevented).toBe(false);
      expect(requestAdjacentFile).toHaveBeenCalledTimes(1);
    });

    it('does not choose between multiple previews when focus is on the body', () => {
      render(
        <>
          <PreviewPanel {...mockProps} />
          <PreviewPanel {...mockProps} selectedFile={mockFolder} />
        </>,
      );
      vi.mocked(requestAdjacentFile).mockReturnValue(mockFile);
      expect(keyDown(document.body).defaultPrevented).toBe(false);
      expect(requestAdjacentFile).not.toHaveBeenCalled();
    });
  });

  describe('No File Selected', () => {
    it('shows empty state message when no file is selected', () => {
      render(<PreviewPanel {...mockProps} selectedFile={null} />);

      expect(screen.getByText(i18n.t('previewPanel.selectFileToPreview'))).toBeInTheDocument();
    });

    it('shows file icon in empty state', () => {
      const { container } = render(<PreviewPanel {...mockProps} selectedFile={null} />);

      const icon = container.querySelector('.wisp-preview-empty-visual[aria-hidden="true"] svg');
      expect(icon).toBeInTheDocument();
    });
  });

  describe('File Properties Section', () => {
    it('displays the file name', () => {
      render(<PreviewPanel {...mockProps} />);

      // Properties section renders immediately (not debounced)
      expect(screen.getByRole('button', { name: 'Show file properties' })).toHaveTextContent(
        'document.txt',
      );
    });

    it('displays file size for non-directory files', () => {
      render(<PreviewPanel {...mockProps} />);

      expect(mockProps.formatFileSize).toHaveBeenCalledWith(1024);
    });

    it('displays "Folder" for directory files', () => {
      render(<PreviewPanel {...mockProps} selectedFile={mockFolder} />);

      expect(screen.getAllByText('Folder').length).toBeGreaterThan(0);
    });

    it('displays formatted date', () => {
      render(<PreviewPanel {...mockProps} />);
      expandProperties();

      expect(mockProps.formatDate).toHaveBeenCalledWith(mockFile.modified);
    });

    it('displays file type information', () => {
      render(<PreviewPanel {...mockProps} />);
      expandProperties();

      expect(screen.getByText('Type:')).toBeInTheDocument();
      expect(screen.getByText('File')).toBeInTheDocument();
    });

    it('displays file path', () => {
      render(<PreviewPanel {...mockProps} />);
      expandProperties();

      expect(screen.getByText('Path:')).toBeInTheDocument();
      expect(screen.getByText('C:\\Users\\Test\\document.txt')).toBeInTheDocument();
    });

    it('displays file category', () => {
      render(<PreviewPanel {...mockProps} />);
      expandProperties();

      expect(screen.getByText('Category:')).toBeInTheDocument();
    });

    it('shows copy path button', () => {
      render(<PreviewPanel {...mockProps} />);
      expandProperties();

      expect(screen.getByText(i18n.t('common.copy'))).toBeInTheDocument();
    });
  });

  describe('Properties Collapse/Expand', () => {
    it('toggles properties section visibility', () => {
      render(<PreviewPanel {...mockProps} />);

      // Properties start collapsed to keep the preview area visually quiet.
      expect(screen.queryByText('Type:')).not.toBeInTheDocument();

      // Click the properties header to expand.
      const headerButton = screen.getByRole('button', { name: 'Show file properties' });
      if (headerButton) {
        fireEvent.click(headerButton);
        expect(screen.getByText('Type:')).toBeInTheDocument();
      }
    });

    it('toggles properties open again after collapsing', () => {
      render(<PreviewPanel {...mockProps} />);

      const headerButton = screen.getByRole('button', { name: 'Show file properties' });
      if (headerButton) {
        // Expand
        fireEvent.click(headerButton);
        expect(screen.getByText('Type:')).toBeInTheDocument();

        // Collapse again
        fireEvent.click(headerButton);
        expect(screen.queryByText('Type:')).not.toBeInTheDocument();
      }
    });
  });

  describe('Folder Preview', () => {
    it('renders folder details when a folder is selected', async () => {
      const folderProps = {
        ...mockProps,
        selectedFile: mockFolder,
        getFolderSize: vi.fn(
          () =>
            ({
              total_size: 10240,
              file_count: 5,
              dir_count: 2,
              is_cached: false,
              cache_timestamp: 0,
            }) as FolderSizeInfo,
        ),
        isCalculatingSize: vi.fn(() => false),
      };

      render(<PreviewPanel {...folderProps} />);

      // Finder-style folder preview: name + item count + size, no card table
      await waitFor(
        () => {
          expect(screen.getAllByText('MyFolder').length).toBeGreaterThan(0);
          // The count and size render inside one summary line. The test
          // i18n mock serves English literals, so assert those directly.
          // Locale varies with test order — accept zh or en literals.
          const summaries = screen.getAllByText((_, el) =>
            Boolean(el?.textContent?.match(/^7 (items|个项目)/)),
          );
          expect(summaries.some((el) => el.textContent?.match(/(10240\s*B|10\s*KB)/))).toBe(true);
        },
        { timeout: 1000 },
      );
    });
  });

  describe('Unsupported File Preview', () => {
    it('explains that a preview is unavailable and offers useful actions', async () => {
      const unknownFile: FileEntry = {
        name: 'data.xyz',
        path: 'C:\\Users\\Test\\data.xyz',
        size: 512,
        is_dir: false,
        modified: Date.now(),
        file_type: 'unknown',
      };

      render(<PreviewPanel {...mockProps} selectedFile={unknownFile} />);

      await waitFor(
        () => {
          expect(screen.getByLabelText('data.xyz')).toBeInTheDocument();
          expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
          expect(screen.getByRole('button', { name: 'Show Details' })).toBeInTheDocument();
          expect(screen.queryByRole('button', { name: 'Retry Preview' })).not.toBeInTheDocument();
        },
        { timeout: 1000 },
      );
    });

    it('does not invent a size-limit explanation for an unknown format', async () => {
      const largeFile: FileEntry = {
        name: 'huge.bin',
        path: 'C:\\Users\\Test\\huge.bin',
        size: 100 * 1024 * 1024, // 100MB
        is_dir: false,
        modified: Date.now(),
        file_type: 'binary',
      };

      render(<PreviewPanel {...mockProps} selectedFile={largeFile} />);

      await waitFor(
        () => {
          expect(screen.getByLabelText('huge.bin')).toBeInTheDocument();
          expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
          expect(screen.queryByText('File too large for sidebar preview')).not.toBeInTheDocument();
        },
        { timeout: 1000 },
      );
    });
  });

  describe('MIME Type Display', () => {
    it('displays MIME type when available', () => {
      const fileWithMime: FileEntry = {
        ...mockFile,
        mime_type: 'text/plain',
      };

      render(<PreviewPanel {...mockProps} selectedFile={fileWithMime} />);
      expandProperties();

      expect(screen.getByText('MIME Type:')).toBeInTheDocument();
      expect(screen.getByText('text/plain')).toBeInTheDocument();
    });

    it('does not display MIME type when not available', () => {
      render(<PreviewPanel {...mockProps} />);

      expect(screen.queryByText('MIME Type:')).not.toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles file with zero size', () => {
      const emptyFile: FileEntry = {
        ...mockFile,
        size: 0,
      };

      expect(() => render(<PreviewPanel {...mockProps} selectedFile={emptyFile} />)).not.toThrow();
    });

    it('handles file with very long name', () => {
      const longNameFile: FileEntry = {
        ...mockFile,
        name: `${'a'.repeat(200)}.txt`,
      };

      expect(() =>
        render(<PreviewPanel {...mockProps} selectedFile={longNameFile} />),
      ).not.toThrow();
    });

    it('handles switching from file to null', () => {
      const { rerender } = render(<PreviewPanel {...mockProps} />);
      expect(screen.getByRole('region', { name: `Preview of ${mockFile.name}` })).toHaveAttribute(
        'data-file-preview',
        mockFile.path,
      );

      rerender(<PreviewPanel {...mockProps} selectedFile={null} />);

      expect(screen.getByText(i18n.t('previewPanel.selectFileToPreview'))).toBeInTheDocument();
      expect(screen.getByRole('region')).not.toHaveAttribute('data-file-preview');
    });

    it('handles switching between different files', () => {
      const { rerender } = render(<PreviewPanel {...mockProps} />);

      const newFile: FileEntry = {
        name: 'other.txt',
        path: 'C:\\Users\\Test\\other.txt',
        size: 2048,
        is_dir: false,
        modified: Date.now(),
        file_type: 'text',
      };

      rerender(<PreviewPanel {...mockProps} selectedFile={newFile} />);

      // The properties section updates immediately (not debounced)
      // Use getAllByText since the name may appear in both header and path
      expect(screen.getAllByText('other.txt').length).toBeGreaterThan(0);
      expect(screen.getByRole('region', { name: `Preview of ${newFile.name}` })).toHaveAttribute(
        'data-file-preview',
        newFile.path,
      );
    });
  });
});
