import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import type { FileEntry } from '@/lib/tauri-api';
import type { PreviewProps } from '@/lib/preview-factory';

const mocks = vi.hoisted(() => ({
  native: vi.fn(() => true),
  openFile: vi.fn(),
  sniff: vi.fn(),
  readText: vi.fn(),
  canPreview: vi.fn(),
  getFileType: vi.fn(),
  getPreviewComponent: vi.fn(),
  queryPreview: vi.fn(),
}));

vi.mock('@/lib/transport', () => ({ isTauri: mocks.native }));
vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    openFile: mocks.openFile,
    previewSniffText: mocks.sniff,
    readTextFile: mocks.readText,
  },
}));
vi.mock('@/lib/preview-factory', () => ({
  defaultPreviewFactory: {
    canPreview: mocks.canPreview,
    getFileType: mocks.getFileType,
    getPreviewComponent: mocks.getPreviewComponent,
  },
}));
vi.mock('@/lib/extension-host', () => ({
  extensionHost: { queryPreview: mocks.queryPreview },
}));
vi.mock('@/components/explorer/FinderFileIcon', () => ({
  default: ({ file }: { file: FileEntry }) => (
    <span aria-hidden="true" data-finder-file-icon={file.path} />
  ),
}));
vi.mock('@/components/ui/Skeleton', () => ({
  PreviewSkeleton: () => <div role="status">Loading preview</div>,
}));

const unknownFile: FileEntry = {
  name: 'notes.xyz',
  path: '/Users/test/notes.xyz',
  size: 256,
  modified: 1_700_000_000,
  is_dir: false,
  file_type: 'unknown',
};
const props = {
  selectedFile: unknownFile,
  formatFileSize: (size: number) => `${size} B`,
  formatDate: () => '2026-09-12',
};

let PreviewPanel: typeof import('@/components/panels/PreviewPanel').default;

describe('preview fallback interactions', () => {
  beforeEach(async () => {
    // Each case starts with an empty preview-module cache.
    vi.resetModules();
    mocks.native.mockReturnValue(true);
    mocks.openFile.mockReset().mockResolvedValue(undefined);
    mocks.sniff.mockReset().mockResolvedValue(false);
    mocks.readText.mockReset().mockResolvedValue('file contents');
    mocks.canPreview.mockReset().mockReturnValue(false);
    mocks.getFileType.mockReset().mockReturnValue('unknown');
    mocks.getPreviewComponent.mockReset().mockResolvedValue(null);
    mocks.queryPreview.mockReset().mockReturnValue(null);
    ({ default: PreviewPanel } = await import('@/components/panels/PreviewPanel'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('names an unsupported file and its type without offering a futile retry', async () => {
    render(<PreviewPanel {...props} />);

    expect(await screen.findByText('Preview unavailable')).toBeVisible();
    expect(screen.getByRole('region', { name: unknownFile.name })).toBeVisible();
    expect(screen.getByText('XYZ file')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open in Default App' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Retry Preview' })).not.toBeInTheDocument();
    expect(screen.queryByText(/damaged|corrupt/i)).not.toBeInTheDocument();
  });

  it('identifies a known format rejected by its size limit without retry or text sniffing', async () => {
    mocks.getFileType.mockReturnValue('pdf');
    const file = { ...unknownFile, name: 'book.pdf', path: '/book.pdf', size: 200 * 1024 * 1024 };
    render(<PreviewPanel {...props} selectedFile={file} />);

    expect(await screen.findByText('File too large for sidebar preview')).toBeVisible();
    expect(screen.getByText('PDF file')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry Preview' })).not.toBeInTheDocument();
    expect(mocks.sniff).not.toHaveBeenCalled();
    expect(mocks.getPreviewComponent).not.toHaveBeenCalled();
  });

  it('opens the original file through the system application using the keyboard', async () => {
    const user = userEvent.setup();
    render(<PreviewPanel {...props} />);
    const open = await screen.findByRole('button', { name: 'Open in Default App' });

    await user.tab();
    expect(open).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(mocks.openFile).toHaveBeenCalledTimes(1);
    expect(mocks.openFile).toHaveBeenCalledWith(unknownFile.path);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/successfully opened/i)).not.toBeInTheDocument();
  });

  it('prevents duplicate open requests and gives readable feedback when opening fails', async () => {
    let rejectOpen!: (reason: Error) => void;
    mocks.openFile.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => (rejectOpen = reject)),
    );
    render(<PreviewPanel {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open in Default App' }));
    const pending = screen.getByRole('button', { name: 'Opening…' });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(mocks.openFile).toHaveBeenCalledTimes(1);

    await act(async () => rejectOpen(new Error('ENOENT: low-level detail')));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not open this file');
    expect(screen.getByRole('alert')).not.toHaveTextContent('ENOENT');
    const open = screen.getByRole('button', { name: 'Open in Default App' });
    expect(open).toBeEnabled();
    fireEvent.click(open);
    await waitFor(() => expect(open).toBeEnabled());
    expect(mocks.openFile).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains the browser limitation instead of pretending to open a local file', async () => {
    mocks.native.mockReturnValue(false);
    render(<PreviewPanel {...props} />);

    const open = await screen.findByRole('button', { name: 'Open in Default App' });
    expect(open).toBeDisabled();
    expect(open).toHaveAccessibleDescription(
      'Use Wisp for desktop to open this file in its default application.',
    );
    fireEvent.click(open);
    expect(mocks.openFile).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Show Details' })).toBeEnabled();
  });

  it('opens file details and places keyboard focus at the expanded properties', async () => {
    const user = userEvent.setup();
    render(<PreviewPanel {...props} />);
    const details = await screen.findByRole('button', { name: 'Show Details' });
    details.focus();
    await user.keyboard(' ');

    const toggle = screen.getByRole('button', { name: 'Hide file properties' });
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBeVisible();
    expect(screen.getByText(unknownFile.path)).toBeVisible();
  });

  it('retries a failed renderer import and replaces the fallback with the loaded preview', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.canPreview.mockReturnValue(true);
    mocks.getFileType.mockReturnValue('image');
    mocks.getPreviewComponent
      .mockRejectedValueOnce(new Error('Network error importing renderer'))
      .mockResolvedValueOnce(() => <div>Recovered preview</div>);
    render(<PreviewPanel {...props} />);

    expect(await screen.findByRole('heading', { name: 'Could not load preview' })).toBeVisible();
    expect(screen.queryByText(/corrupt|damaged|Network error/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Preview' }));

    expect(await screen.findByText('Recovered preview')).toBeVisible();
    expect(mocks.getPreviewComponent).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Retry Preview' })).not.toBeInTheDocument();
  });

  it('retries an onError failure with a fresh renderer rather than keeping the failed cache', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.canPreview.mockReturnValue(true);
    mocks.getFileType.mockReturnValue('pdf');
    mocks.getPreviewComponent
      .mockResolvedValueOnce(({ onError }: PreviewProps) => (
        <button onClick={() => onError?.(new Error('Could not load data'))}>Fail renderer</button>
      ))
      .mockResolvedValueOnce(() => <div>Retried file content</div>);
    render(<PreviewPanel {...props} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Fail renderer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry Preview' }));
    expect(await screen.findByText('Retried file content')).toBeVisible();
    expect(mocks.getPreviewComponent).toHaveBeenCalledTimes(2);
  });

  it('treats a read failure during text detection as a load failure, not unsupported format', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.sniff.mockRejectedValueOnce(new Error('Permission denied'));
    render(<PreviewPanel {...props} />);

    expect(await screen.findByRole('heading', { name: 'Could not load preview' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Preview' }));
    expect(await screen.findByText('Preview unavailable')).toBeVisible();
    expect(mocks.sniff).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Retry Preview' })).not.toBeInTheDocument();
  });

  it('displays an extension preview even when no built-in preview exists', async () => {
    const renderExtension = vi.fn(() => <div>Extension content</div>);
    mocks.queryPreview.mockReturnValue({ render: renderExtension });
    render(<PreviewPanel {...props} />);

    expect(await screen.findByText('Extension content')).toBeVisible();
    expect(renderExtension).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: unknownFile.path }),
    );
    expect(mocks.canPreview).not.toHaveBeenCalled();
    expect(mocks.getPreviewComponent).not.toHaveBeenCalled();
    expect(screen.queryByText('Preview unavailable')).not.toBeInTheDocument();
  });

  it('lets a failed extension retry its own renderer', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const renderExtension = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Extension unavailable');
      })
      .mockReturnValueOnce(<div>Extension recovered</div>);
    mocks.queryPreview.mockReturnValue({ render: renderExtension });
    render(<PreviewPanel {...props} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry Preview' }));
    expect(await screen.findByText('Extension recovered')).toBeVisible();
    expect(renderExtension).toHaveBeenCalledTimes(2);
    expect(mocks.getPreviewComponent).not.toHaveBeenCalled();
  });

  it('recovers React render errors inside an extension through the same retry action', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const BrokenExtension = () => {
      throw new Error('Extension render failed');
    };
    mocks.queryPreview
      .mockReturnValueOnce({ render: () => <BrokenExtension /> })
      .mockReturnValueOnce({ render: () => <div>Recreated extension</div> });
    render(<PreviewPanel {...props} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry Preview' }));
    expect(await screen.findByText('Recreated extension')).toBeVisible();
  });

  it('keeps the 200ms debounce and discards an old pending preview after selection changes', async () => {
    vi.useFakeTimers();
    let finishOld!: (component: ComponentType<PreviewProps>) => void;
    mocks.canPreview.mockReturnValue(true);
    mocks.getFileType.mockReturnValue('image');
    mocks.getPreviewComponent
      .mockImplementationOnce(
        () => new Promise<ComponentType<PreviewProps>>((resolve) => (finishOld = resolve)),
      )
      .mockResolvedValueOnce(() => <div>New file content</div>);
    const { rerender } = render(<PreviewPanel {...props} />);
    expect(mocks.getPreviewComponent).toHaveBeenCalledTimes(1);
    const nextFile = { ...unknownFile, name: 'next.xyz', path: '/Users/test/next.xyz' };
    rerender(<PreviewPanel {...props} selectedFile={nextFile} />);

    await act(async () => {
      finishOld(() => <div>Old file content</div>);
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(mocks.getPreviewComponent).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Old file content')).not.toBeInTheDocument();
    expect(screen.getByText('Loading preview')).toBeVisible();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(mocks.getPreviewComponent).toHaveBeenCalledTimes(2);
    expect(screen.getByText('New file content')).toBeVisible();
    expect(screen.queryByText('Old file content')).not.toBeInTheDocument();
  });
});
