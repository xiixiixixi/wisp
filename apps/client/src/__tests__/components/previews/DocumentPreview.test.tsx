import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import DocumentPreview from '@/components/previews/DocumentPreview';
import type { FileEntry } from '@/lib/tauri-api';

const mocks = vi.hoisted(() => ({
  native: vi.fn(() => true),
  previewDocHtml: vi.fn(),
  readBinaryFile: vi.fn(),
  convertToHtml: vi.fn(),
}));

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    previewDocHtml: mocks.previewDocHtml,
    readBinaryFile: mocks.readBinaryFile,
  },
}));
vi.mock('@/lib/transport', () => ({
  isTauri: mocks.native,
  convertAssetUrl: (path: string) => `asset://localhost${path}`,
}));
vi.mock('mammoth', () => ({ convertToHtml: mocks.convertToHtml }));
vi.mock('@/components/ui/Skeleton', () => ({
  PreviewSkeleton: () => <div role="status">Loading document</div>,
}));

const file: FileEntry = {
  name: 'report.doc',
  path: '/Users/test/report.doc',
  size: 1024,
  modified: 1_700_000_000,
  is_dir: false,
  file_type: 'document',
};
const docx = { ...file, name: 'report.docx', path: '/Users/test/report.docx' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('DocumentPreview conversion lifecycle', () => {
  beforeEach(() => {
    mocks.native.mockReturnValue(true);
    mocks.previewDocHtml.mockReset().mockResolvedValue('/converted/report.html');
    mocks.readBinaryFile.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.convertToHtml
      .mockReset()
      .mockResolvedValue({ value: '<p>Converted DOCX</p>', messages: [] });
  });

  it.each(['rejected', 'empty'] as const)(
    'forwards a %s native conversion for a non-DOCX file to the parent error handler',
    async (result) => {
      if (result === 'rejected')
        {mocks.previewDocHtml.mockRejectedValue(new Error('Conversion failed'));}
      else mocks.previewDocHtml.mockResolvedValue(null);
      const onError = vi.fn();
      const onLoad = vi.fn();
      render(<DocumentPreview file={file} onError={onError} onLoad={onLoad} />);

      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(onError.mock.calls[0][0].message).toBeTruthy();
      expect(onLoad).not.toHaveBeenCalled();
      expect(mocks.readBinaryFile).not.toHaveBeenCalled();
      expect(screen.queryByTitle(file.name)).not.toBeInTheDocument();
    },
  );

  it('shows a successful native conversion in the sandboxed document viewer', async () => {
    const onError = vi.fn();
    const onLoad = vi.fn();
    render(<DocumentPreview file={file} onError={onError} onLoad={onLoad} />);

    const frame = await screen.findByTitle(file.name);
    expect(frame).toHaveAttribute('src', 'asset://localhost/converted/report.html');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(mocks.readBinaryFile).not.toHaveBeenCalled();
  });

  it('still converts DOCX through mammoth when native conversion fails', async () => {
    mocks.previewDocHtml.mockRejectedValue(new Error('Native conversion unavailable'));
    const onError = vi.fn();
    const onLoad = vi.fn();
    render(<DocumentPreview file={docx} onError={onError} onLoad={onLoad} />);

    expect(await screen.findByText('Converted DOCX')).toBeVisible();
    expect(mocks.readBinaryFile).toHaveBeenCalledWith(docx.path);
    expect(mocks.convertToHtml).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)(
    'discards an old native %s after a different file has loaded',
    async (result) => {
      const pending = deferred<string>();
      mocks.previewDocHtml
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce('/converted/new.html');
      const onError = vi.fn();
      const onLoad = vi.fn();
      const { rerender } = render(
        <DocumentPreview file={file} onError={onError} onLoad={onLoad} />,
      );
      const next = { ...file, name: 'new.doc', path: '/Users/test/new.doc' };
      rerender(<DocumentPreview file={next} onError={onError} onLoad={onLoad} />);
      expect(await screen.findByTitle(next.name)).toHaveAttribute(
        'src',
        'asset://localhost/converted/new.html',
      );

      await act(async () => {
        if (result === 'success') pending.resolve('/converted/old.html');
        else pending.reject(new Error('Old conversion failed'));
      });
      expect(screen.getByTitle(next.name)).toHaveAttribute(
        'src',
        'asset://localhost/converted/new.html',
      );
      expect(onLoad).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    },
  );

  it('discards old mammoth output after switching to another file', async () => {
    const pending = deferred<{ value: string; messages: [] }>();
    mocks.previewDocHtml.mockResolvedValueOnce(null).mockResolvedValueOnce('/converted/new.html');
    mocks.convertToHtml.mockReturnValueOnce(pending.promise);
    const onError = vi.fn();
    const onLoad = vi.fn();
    const { rerender } = render(<DocumentPreview file={docx} onError={onError} onLoad={onLoad} />);
    await waitFor(() => expect(mocks.convertToHtml).toHaveBeenCalledTimes(1));
    rerender(<DocumentPreview file={file} onError={onError} onLoad={onLoad} />);
    await screen.findByTitle(file.name);

    await act(async () => pending.resolve({ value: '<p>Old DOCX content</p>', messages: [] }));
    expect(screen.queryByText('Old DOCX content')).not.toBeInTheDocument();
    expect(screen.getByTitle(file.name)).toHaveAttribute(
      'src',
      'asset://localhost/converted/new.html',
    );
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('ignores conversion results after unmounting', async () => {
    const pending = deferred<string>();
    mocks.previewDocHtml.mockReturnValueOnce(pending.promise);
    const onError = vi.fn();
    const onLoad = vi.fn();
    const { unmount } = render(<DocumentPreview file={file} onError={onError} onLoad={onLoad} />);
    unmount();

    await act(async () => pending.reject(new Error('Late native failure')));
    expect(onLoad).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('stops the DOCX pipeline before mammoth when the binary read finishes after unmount', async () => {
    const pending = deferred<Uint8Array>();
    mocks.previewDocHtml.mockResolvedValueOnce(null);
    mocks.readBinaryFile.mockReturnValueOnce(pending.promise);
    const onError = vi.fn();
    const onLoad = vi.fn();
    const { unmount } = render(<DocumentPreview file={docx} onError={onError} onLoad={onLoad} />);
    await waitFor(() => expect(mocks.readBinaryFile).toHaveBeenCalledTimes(1));
    unmount();

    await act(async () => pending.resolve(new Uint8Array([1, 2, 3])));
    expect(mocks.convertToHtml).not.toHaveBeenCalled();
    expect(onLoad).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
