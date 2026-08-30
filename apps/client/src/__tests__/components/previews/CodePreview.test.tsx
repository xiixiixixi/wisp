import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import CodePreview from '@/components/previews/CodePreview';
import { FileEntry, TauriAPI } from '@/lib/tauri-api';

// CodeMirror stub: renders the buffer as text, exposes a fake view for the
// save path, and a trigger button that fires onDocChanged.
vi.mock('@/lib/codemirror', () => ({
  WispCodeMirror: ({
    doc,
    readOnly,
    fileName,
    onSave,
    editorRef,
    onDocChanged,
    onLanguageLoaded,
  }: {
    doc: string;
    readOnly: boolean;
    fileName: string;
    onSave?: () => void;
    editorRef?: { current: unknown };
    onDocChanged?: () => void;
    onLanguageLoaded?: (name: string) => void;
  }) => {
    React.useEffect(() => {
      if (editorRef) {
        editorRef.current = { state: { doc: { toString: () => doc } } };
      }
      const timer = setTimeout(() => onLanguageLoaded?.('JavaScript'), 0);
      return () => clearTimeout(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div data-testid="cm-editor" data-read-only={String(readOnly)} data-file-name={fileName}>
        {doc}
        <button type="button" data-testid="cm-edit-trigger" onClick={onDocChanged}>
          edit
        </button>
        <button type="button" data-testid="cm-save-trigger" onClick={onSave}>
          save
        </button>
      </div>
    );
  },
}));

vi.mock('@/components/previews/CodeAIActions', () => ({
  default: () => <div data-testid="code-ai-actions" />,
}));

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    readTextFile: vi.fn(() => Promise.resolve('const x = 1;\nconsole.log(x);')),
    saveTextFile: vi.fn(() => Promise.resolve()),
  },
  FileEntry: {},
}));

describe('CodePreview', () => {
  const mockFile: FileEntry = {
    name: 'script.js',
    path: 'C:\\Users\\Test\\script.js',
    size: 512,
    is_dir: false,
    modified: Date.now(),
    file_type: 'code',
  };

  const mockProps = {
    file: mockFile,
    onError: vi.fn(),
    onLoad: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Loading State', () => {
    it('shows loading state initially', () => {
      vi.mocked(TauriAPI.readTextFile).mockReturnValueOnce(new Promise(() => {}));

      render(<CodePreview {...mockProps} />);

      expect(screen.getByRole('status', { name: 'Loading preview' })).toBeInTheDocument();
    });
  });

  describe('Successful Load', () => {
    it('renders full code content after loading (no truncation)', async () => {
      const longCode = `const x = 1;\n${'// line\n'.repeat(800)}console.log(x);`;
      vi.mocked(TauriAPI.readTextFile).mockResolvedValueOnce(longCode);

      render(<CodePreview {...mockProps} />);

      await waitFor(() => {
        const editor = screen.getByTestId('cm-editor');
        expect(editor.textContent).toContain('const x = 1;');
        expect(editor.textContent).toContain('console.log(x);');
        // CodeMirror 6 previews the whole buffer — no 2000-char cut
        expect(editor.textContent).toContain('// line');
      });
    });

    it('calls onLoad after successful load', async () => {
      vi.mocked(TauriAPI.readTextFile).mockResolvedValueOnce('code');

      render(<CodePreview {...mockProps} />);

      await waitFor(() => {
        expect(mockProps.onLoad).toHaveBeenCalled();
      });
    });

    it('reads file content using TauriAPI', async () => {
      render(<CodePreview {...mockProps} />);

      await waitFor(() => {
        expect(TauriAPI.readTextFile).toHaveBeenCalledWith('C:\\Users\\Test\\script.js');
      });
    });

    it('is read-only until the user enters edit mode', async () => {
      const user = userEvent.setup();
      vi.mocked(TauriAPI.readTextFile).mockResolvedValueOnce('code');

      render(<CodePreview {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('cm-editor')).toHaveAttribute('data-read-only', 'true');
      });

      await user.click(screen.getByRole('button', { name: 'Edit' }));
      expect(screen.getByTestId('cm-editor')).toHaveAttribute('data-read-only', 'false');

      await user.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.getByTestId('cm-editor')).toHaveAttribute('data-read-only', 'true');
    });

    it('shows the resolved language badge', async () => {
      vi.mocked(TauriAPI.readTextFile).mockResolvedValueOnce('const x = 1;');

      render(<CodePreview {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('JavaScript')).toBeInTheDocument();
      });
    });
  });

  describe('Editing & Saving', () => {
    it('saves the edited buffer through TauriAPI.saveTextFile', async () => {
      const user = userEvent.setup();
      vi.mocked(TauriAPI.readTextFile).mockResolvedValueOnce('const x = 1;');

      render(<CodePreview {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('cm-editor')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Edit' }));
      await user.click(screen.getByTestId('cm-edit-trigger')); // dirty flag
      expect(screen.getByText(/unsaved/)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => {
        expect(TauriAPI.saveTextFile).toHaveBeenCalledWith(
          'C:\\Users\\Test\\script.js',
          'const x = 1;',
        );
      });
    });

    it('saves via the in-editor Cmd/Ctrl+S binding', async () => {
      const user = userEvent.setup();
      vi.mocked(TauriAPI.readTextFile).mockResolvedValueOnce('const x = 1;');

      render(<CodePreview {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByTestId('cm-editor')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'Edit' }));
      await user.click(screen.getByTestId('cm-edit-trigger'));
      await user.click(screen.getByTestId('cm-save-trigger'));

      await waitFor(() => {
        expect(TauriAPI.saveTextFile).toHaveBeenCalled();
      });
    });
  });

  describe('Error Handling', () => {
    it('shows error state when file read fails', async () => {
      vi.mocked(TauriAPI.readTextFile).mockRejectedValueOnce(new Error('File not found'));

      render(<CodePreview {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('Cannot preview this file')).toBeInTheDocument();
        expect(screen.getByText('File not found')).toBeInTheDocument();
      });
    });

    it('calls onError when file read fails', async () => {
      const error = new Error('Permission denied');
      vi.mocked(TauriAPI.readTextFile).mockRejectedValueOnce(error);

      render(<CodePreview {...mockProps} />);

      await waitFor(() => {
        expect(mockProps.onError).toHaveBeenCalledWith(error);
      });
    });
  });
});
