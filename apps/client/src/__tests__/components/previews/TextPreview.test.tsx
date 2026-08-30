import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import TextPreview from '@/components/previews/TextPreview';
import { FileEntry, TauriAPI } from '@/lib/tauri-api';

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

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    readTextFile: vi.fn(() => Promise.resolve('Plain text line one.\nLine two.')),
    saveTextFile: vi.fn(() => Promise.resolve()),
  },
  FileEntry: {},
}));

describe('TextPreview', () => {
  const mockFile: FileEntry = {
    name: 'test.txt',
    path: 'C:\\Users\\Test\\test.txt',
    size: 1024,
    is_dir: false,
    modified: Date.now(),
    file_type: 'text',
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

    render(<TextPreview {...mockProps} />);

    expect(screen.getByRole('status', { name: 'Loading preview' })).toBeInTheDocument();
  });

  it('renders the full text without truncation', async () => {
    const longText = 'word '.repeat(4000); // > 5000 chars, old limit
    vi.mocked(TauriAPI.readTextFile).mockResolvedValueOnce(longText);

    render(<TextPreview {...mockProps} />);

    await waitFor(() => {
      const editor = screen.getByTestId('cm-editor');
      expect(editor.textContent).toContain('word');
      expect(editor.textContent!.length).toBeGreaterThan(5000);
    });
  });

  it('calls onLoad after successful load', async () => {
    render(<TextPreview {...mockProps} />);

    await waitFor(() => {
      expect(mockProps.onLoad).toHaveBeenCalled();
    });
  });

  it('toggles between read-only preview and editing', async () => {
    const user = userEvent.setup();
    render(<TextPreview {...mockProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('cm-editor')).toHaveAttribute('data-read-only', 'true');
    });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByTestId('cm-editor')).toHaveAttribute('data-read-only', 'false');
  });

  it('saves edits through TauriAPI.saveTextFile', async () => {
    const user = userEvent.setup();
    vi.mocked(TauriAPI.readTextFile).mockResolvedValueOnce('Plain text line one.\nLine two.');

    render(<TextPreview {...mockProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('cm-editor')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByTestId('cm-edit-trigger'));

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(TauriAPI.saveTextFile).toHaveBeenCalledWith(
        'C:\\Users\\Test\\test.txt',
        'Plain text line one.\nLine two.',
      );
    });
  });

  it('calls onError when file read fails', async () => {
    const error = new Error('Disk error');
    vi.mocked(TauriAPI.readTextFile).mockRejectedValueOnce(error);

    render(<TextPreview {...mockProps} />);

    await waitFor(() => {
      expect(mockProps.onError).toHaveBeenCalledWith(error);
      expect(screen.getByText('Cannot preview this file')).toBeInTheDocument();
    });
  });
});
