import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import MarkdownPreview from '@/components/previews/MarkdownPreview';
import HtmlPreview from '@/components/previews/HtmlPreview';
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
    const buffer = React.useRef(doc);
    const [value, setValue] = React.useState(doc);
    React.useEffect(() => {
      buffer.current = doc;
      setValue(doc);
    }, [doc]);
    React.useEffect(() => {
      if (editorRef) editorRef.current = { state: { doc: { toString: () => buffer.current } } };
      return () => {
        if (editorRef) editorRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div data-testid="cm-editor" data-read-only={String(readOnly)}>
        {doc}
        <textarea
          aria-label="Source draft"
          value={value}
          onChange={(event) => {
            buffer.current = event.target.value;
            setValue(event.target.value);
            onDocChanged?.();
          }}
        />
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

      await user.click(screen.getByRole('tab', { name: 'Edit' }));

      expect(screen.getByTestId('cm-editor')).toHaveAttribute('data-read-only', 'false');
      expect(screen.getByTestId('cm-editor').textContent).toContain('# Hello World');
    });

    it('saves source edits through TauriAPI.saveTextFile', async () => {
      const user = userEvent.setup();
      render(<MarkdownPreview {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: 'Edit' }));
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

  it('previews and saves the unsaved draft without unmounting the editor', async () => {
    render(<MarkdownPreview {...mockProps} />);
    await screen.findByRole('heading', { name: 'Hello World' });
    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    const editor = screen.getByTestId('cm-editor');
    fireEvent.change(screen.getByRole('textbox', { name: 'Source draft' }), {
      target: { value: '# Updated draft' },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    expect(screen.getByRole('heading', { name: 'Updated draft' })).toBeInTheDocument();
    expect(editor).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(TauriAPI.saveTextFile).toHaveBeenCalledWith(mockFile.path, '# Updated draft'),
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    expect(screen.getByTestId('cm-editor')).toBe(editor);
    expect(screen.getByRole('textbox', { name: 'Source draft' })).toHaveValue('# Updated draft');
  });

  it('supports arrow-key mode switching with correct selected state', async () => {
    render(<MarkdownPreview {...mockProps} />);
    await screen.findByRole('heading', { name: 'Hello World' });
    const preview = screen.getByRole('tab', { name: 'Preview' });
    preview.focus();
    fireEvent.keyDown(preview, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Edit' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Edit' })).toHaveFocus();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  it('does not discard newer typing when an earlier save finishes', async () => {
    let finishSave!: () => void;
    vi.mocked(TauriAPI.saveTextFile).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishSave = resolve;
      }),
    );
    render(<MarkdownPreview {...mockProps} />);
    await screen.findByRole('heading', { name: 'Hello World' });
    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    const source = screen.getByRole('textbox', { name: 'Source draft' });
    fireEvent.change(source, { target: { value: '# First draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.change(source, { target: { value: '# Newer typing' } });
    await act(async () => finishSave());
    expect(source).toHaveValue('# Newer typing');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    expect(screen.getByRole('heading', { name: 'Newer typing' })).toBeInTheDocument();
  });

  it('keeps the draft and Save action after a failed save', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.mocked(TauriAPI.saveTextFile).mockRejectedValueOnce(new Error('Disk full'));
    render(<MarkdownPreview {...mockProps} />);
    await screen.findByRole('heading', { name: 'Hello World' });
    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Source draft' }), {
      target: { value: '# Keep this draft' },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining('Disk full')));
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Keep this draft' })).toBeInTheDocument();
    alert.mockRestore();
  });

  it('also retains HTML source and previews its live draft across mode switches', async () => {
    vi.mocked(TauriAPI.readTextFile).mockResolvedValueOnce('<h1>Original</h1>');
    const file = { ...mockFile, name: 'index.html', path: '/index.html' };
    const { container } = render(<HtmlPreview {...mockProps} file={file} />);
    await waitFor(() =>
      expect(container.querySelector('iframe')).toHaveAttribute('srcdoc', '<h1>Original</h1>'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const editor = screen.getByTestId('cm-editor');
    fireEvent.change(screen.getByRole('textbox', { name: 'Source draft' }), {
      target: { value: '<h1>Updated</h1>' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(container.querySelector('iframe')).toHaveAttribute('srcdoc', '<h1>Updated</h1>');
    expect(editor).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(TauriAPI.saveTextFile).toHaveBeenCalledWith('/index.html', '<h1>Updated</h1>'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByTestId('cm-editor')).toBe(editor);
  });
});
