import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import MarkdownPreview from '@/components/previews/MarkdownPreview';
import { FileEntry, TauriAPI } from '@/lib/tauri-api';

// CodeMirror stub: rendered tab tests don't need a live editor.
vi.mock('@/lib/codemirror', () => ({
  WispCodeMirror: ({
    doc,
    readOnly,
    editorRef,
    onDocChanged,
  }: {
    doc: string;
    readOnly: boolean;
    editorRef?: { current: unknown };
    onDocChanged?: () => void;
  }) => {
    React.useEffect(() => {
      if (editorRef) editorRef.current = { state: { doc: { toString: () => doc } } };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div data-testid="cm-editor" data-read-only={String(readOnly)}>
        {doc}
        <button type="button" data-testid="cm-edit-trigger" onClick={onDocChanged}>
          edit
        </button>
      </div>
    );
  },
}));

// Shiki stub: synchronous marker instead of the real highlighter.
vi.mock('@/lib/shiki', () => ({
  highlightCode: vi.fn((code: string) => Promise.resolve(`<pre data-testid="shiki">${code}</pre>`)),
}));

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    readTextFile: vi.fn(() => Promise.resolve('# Hello World\n\nThis is a test.')),
    saveTextFile: vi.fn(() => Promise.resolve()),
  },
  FileEntry: {},
}));

describe('MarkdownPreview', () => {
  const mockFile: FileEntry = {
    name: 'README.md',
    path: 'C:\\Users\\Test\\README.md',
    size: 512,
    is_dir: false,
    modified: Date.now(),
    file_type: 'markdown',
  };

  const mockProps = {
    file: mockFile,
    onError: vi.fn(),
    onLoad: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    vi.mocked(TauriAPI.readTextFile).mockReturnValueOnce(new Promise(() => {}));

    render(<MarkdownPreview {...mockProps} />);

    expect(screen.getByRole('status', { name: 'Loading preview' })).toBeInTheDocument();
  });

  describe('Rendered Tab', () => {
    it('renders markdown as HTML after loading', async () => {
      render(<MarkdownPreview {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello World');
        expect(screen.getByText('This is a test.')).toBeInTheDocument();
      });
    });

    it('renders GFM tables', async () => {
      vi.mocked(TauriAPI.readTextFile).mockResolvedValueOnce('| a | b |\n| --- | --- |\n| 1 | 2 |');

      render(<MarkdownPreview {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByRole('table')).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: 'a' })).toBeInTheDocument();
        expect(screen.getByRole('cell', { name: '1' })).toBeInTheDocument();
      });
    });

    it('highlights fenced code blocks through Shiki', async () => {
      vi.mocked(TauriAPI.readTextFile).mockResolvedValueOnce('```js\nconst x = 1;\n```');

      render(<MarkdownPreview {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('shiki')).toBeInTheDocument();
        expect(screen.getByTestId('shiki').textContent).toContain('const x = 1;');
      });
    });

    it('calls onLoad after successful load', async () => {
      render(<MarkdownPreview {...mockProps} />);

      await waitFor(() => {
        expect(mockProps.onLoad).toHaveBeenCalled();
      });
    });
  });

  describe('Edit Tab', () => {
    it('switches to a CodeMirror source editor for editing', async () => {
      const user = userEvent.setup();
      render(<MarkdownPreview {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Edit' }));

      expect(screen.getByTestId('cm-editor')).toHaveAttribute('data-read-only', 'false');
      expect(screen.getByTestId('cm-editor').textContent).toContain('# Hello World');
    });

    it('saves source edits through TauriAPI.saveTextFile', async () => {
      const user = userEvent.setup();
      render(<MarkdownPreview {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Edit' }));
      await user.click(screen.getByTestId('cm-edit-trigger'));

      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => {
        expect(TauriAPI.saveTextFile).toHaveBeenCalledWith(
          'C:\\Users\\Test\\README.md',
          '# Hello World\n\nThis is a test.',
        );
      });
    });
  });

  describe('Error Handling', () => {
    it('calls onError when file read fails', async () => {
      const error = new Error('Read failed');
      vi.mocked(TauriAPI.readTextFile).mockRejectedValueOnce(error);

      render(<MarkdownPreview {...mockProps} />);

      await waitFor(() => {
        expect(mockProps.onError).toHaveBeenCalledWith(error);
      });
    });
  });
});
