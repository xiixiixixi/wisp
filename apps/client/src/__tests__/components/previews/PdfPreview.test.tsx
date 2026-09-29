import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PdfPreview from '@/components/previews/PdfPreview';
import type { FileEntry } from '@/lib/tauri-api';

const mocks = vi.hoisted(() => ({
  native: vi.fn(() => true),
  mac: vi.fn(() => true),
  mount: vi.fn(),
  update: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    previewMountQlView: mocks.mount,
    previewUpdateQlView: mocks.update,
    previewCloseQlView: mocks.close,
  },
}));
vi.mock('@/lib/transport', () => ({ isTauri: mocks.native }));
vi.mock('@/lib/shortcut-utils', () => ({ isMacPlatform: mocks.mac }));

const file: FileEntry = {
  name: 'Report.pdf',
  path: '/Documents/Report.pdf',
  size: 1024,
  modified: 1,
  is_dir: false,
  file_type: 'pdf',
};
const nextFile = { ...file, name: 'Next.pdf', path: '/Documents/Next.pdf' };

describe('PDF sidebar preview routing', () => {
  beforeEach(() => {
    mocks.native.mockReturnValue(true);
    mocks.mac.mockReturnValue(true);
    mocks.mount.mockReset().mockResolvedValue(undefined);
    mocks.update.mockReset().mockResolvedValue(undefined);
    mocks.close.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal(
      'ResizeObserver',
      vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      })),
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return this.hasAttribute('data-native-document')
        ? new DOMRect(600, 80, 400, 500)
        : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    });
  });

  afterEach(async () => {
    cleanup();
    await act(async () => {});
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('embeds Mac PDFs without a browser iframe or web toolbar and switches native sessions', async () => {
    const onLoad = vi.fn();
    const { container, rerender } = render(<PdfPreview file={file} onLoad={onLoad} />);
    await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(1));
    const oldSession = mocks.mount.mock.calls[0][1];
    expect(mocks.mount).toHaveBeenCalledWith(
      file.path,
      oldSession,
      expect.objectContaining({ x: 600, y: 80, width: 400, height: 500 }),
      true,
    );
    expect(container.querySelector('iframe')).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(onLoad).not.toHaveBeenCalled();

    rerender(<PdfPreview file={nextFile} onLoad={onLoad} />);
    await waitFor(() => expect(mocks.mount).toHaveBeenCalledTimes(2));
    const nextSession = mocks.mount.mock.calls[1][1];
    expect(nextSession).not.toBe(oldSession);
    expect(mocks.mount).toHaveBeenLastCalledWith(
      nextFile.path,
      nextSession,
      expect.any(Object),
      true,
    );
    expect(mocks.close).toHaveBeenCalledWith(oldSession);
    expect(mocks.close).not.toHaveBeenCalledWith(nextSession);
    expect(container.querySelector('[data-native-document]')).toHaveAttribute(
      'data-native-document',
      nextFile.path,
    );
    expect(container.querySelector('iframe')).not.toBeInTheDocument();
  });

  it('reports native failure to the parent retry flow without restoring a browser PDF viewer', async () => {
    mocks.mount.mockRejectedValueOnce(new Error('Native view unavailable'));
    const onError = vi.fn();
    const onLoad = vi.fn();
    const { container } = render(<PdfPreview file={file} onError={onError} onLoad={onLoad} />);

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(screen.getByText('Could not load preview')).toBeInTheDocument();
    expect(mocks.close).toHaveBeenCalledWith(mocks.mount.mock.calls[0][1]);
    expect(container.querySelector('iframe')).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('keeps the non-Mac viewer parameters and reports one completed iframe load', () => {
    mocks.mac.mockReturnValue(false);
    const onLoad = vi.fn();
    const onError = vi.fn();
    render(<PdfPreview file={file} onLoad={onLoad} onError={onError} />);

    const frame = screen.getByTitle(file.name);
    expect(frame).toHaveAttribute(
      'src',
      'media://localhost/%2FDocuments%2FReport.pdf#toolbar=0&navpanes=0&scrollbar=0',
    );
    expect(screen.getByRole('status', { name: 'Loading preview' })).toBeInTheDocument();
    expect(onLoad).not.toHaveBeenCalled();
    fireEvent.load(frame);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
    expect(mocks.mount).not.toHaveBeenCalled();
  });

  it('replaces the browser file and resets loading before the next document is ready', () => {
    mocks.mac.mockReturnValue(false);
    const onLoad = vi.fn();
    const onError = vi.fn();
    const { rerender } = render(<PdfPreview file={file} onLoad={onLoad} onError={onError} />);
    const oldFrame = screen.getByTitle(file.name);
    fireEvent.load(oldFrame);
    expect(onLoad).toHaveBeenCalledTimes(1);

    rerender(<PdfPreview file={nextFile} onLoad={onLoad} onError={onError} />);
    const nextFrame = screen.getByTitle(nextFile.name);
    expect(nextFrame).not.toBe(oldFrame);
    expect(nextFrame).toHaveAttribute(
      'src',
      'media://localhost/%2FDocuments%2FNext.pdf#toolbar=0&navpanes=0&scrollbar=0',
    );
    expect(screen.queryByTitle(file.name)).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading preview' })).toBeInTheDocument();
    expect(onLoad).toHaveBeenCalledTimes(1);
    fireEvent.load(nextFrame);
    expect(onLoad).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  });
});
