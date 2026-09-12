import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuickLookPreview from '@/components/previews/QuickLookPreview';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    previewQlThumbnail: vi.fn(),
    extractDocumentText: vi.fn(),
  },
}));
vi.mock('@/lib/transport', () => ({
  isTauri: vi.fn(() => true),
  convertAssetUrl: (path: string) => `asset://localhost${path}`,
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('QuickLookPreview result handling', () => {
  const file: FileEntry = {
    name: 'Slides.pptx',
    path: '/Documents/Slides.pptx',
    size: 1024,
    modified: 0,
    is_dir: false,
    is_readonly: false,
    file_type: 'presentation',
  };
  const onError = vi.fn();
  const onLoad = vi.fn();
  const props = { file, onError, onLoad };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(TauriAPI.previewQlThumbnail).mockResolvedValue(null);
    vi.mocked(TauriAPI.extractDocumentText).mockResolvedValue('');
  });

  it('reports browser-native preview unavailability without starting native jobs', () => {
    vi.mocked(isTauri).mockReturnValue(false);
    render(<QuickLookPreview {...props} />);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onLoad).not.toHaveBeenCalled();
    expect(TauriAPI.previewQlThumbnail).not.toHaveBeenCalled();
    expect(TauriAPI.extractDocumentText).not.toHaveBeenCalled();
  });

  it.each(['empty', 'rejected'] as const)(
    'reports failure when both native results are %s',
    async (result) => {
      if (result === 'rejected') {
        vi.mocked(TauriAPI.previewQlThumbnail).mockRejectedValueOnce(new Error('No thumbnail'));
        vi.mocked(TauriAPI.extractDocumentText).mockRejectedValueOnce(new Error('No text'));
      } else {
        vi.mocked(TauriAPI.extractDocumentText).mockResolvedValueOnce(' \n ');
      }
      render(<QuickLookPreview {...props} />);

      await waitFor(() => expect(onError).toHaveBeenCalledOnce());
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onLoad).not.toHaveBeenCalled();
    },
  );

  it('waits for both results and accepts extracted text when the thumbnail fails', async () => {
    const thumbnail = deferred<string | null>();
    vi.mocked(TauriAPI.previewQlThumbnail).mockReturnValueOnce(thumbnail.promise);
    vi.mocked(TauriAPI.extractDocumentText).mockResolvedValueOnce('  Slide title\nSlide body  ');
    render(<QuickLookPreview {...props} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onLoad).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(screen.getByRole('status', { name: 'Loading preview' })).toBeInTheDocument();

    await act(async () => thumbnail.reject(new Error('Thumbnail unavailable')));
    expect(screen.getByText(/Slide title/).textContent).toBe('Slide title\nSlide body');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(onLoad).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('accepts a thumbnail when text extraction fails', async () => {
    vi.mocked(TauriAPI.previewQlThumbnail).mockResolvedValueOnce('/cache/slides.png');
    vi.mocked(TauriAPI.extractDocumentText).mockRejectedValueOnce(new Error('No extractor'));
    render(<QuickLookPreview {...props} />);

    expect(await screen.findByRole('img', { name: file.name })).toHaveAttribute(
      'src',
      'asset://localhost/cache/slides.png',
    );
    expect(onLoad).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not extract unsupported text formats and reports an empty thumbnail as failure', async () => {
    render(
      <QuickLookPreview {...props} file={{ ...file, name: 'Model.usdz', path: '/Model.usdz' }} />,
    );

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(TauriAPI.extractDocumentText).not.toHaveBeenCalled();
    expect(onLoad).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)(
    'ignores a stale %s after switching files',
    async (oldResult) => {
      const oldThumbnail = deferred<string | null>();
      const oldText = deferred<string>();
      vi.mocked(TauriAPI.previewQlThumbnail)
        .mockReturnValueOnce(oldThumbnail.promise)
        .mockResolvedValueOnce('/cache/new.png');
      vi.mocked(TauriAPI.extractDocumentText)
        .mockReturnValueOnce(oldText.promise)
        .mockResolvedValueOnce('New slide content');
      const { rerender } = render(<QuickLookPreview {...props} />);
      const nextFile = { ...file, name: 'New.pptx', path: '/Documents/New.pptx' };
      rerender(<QuickLookPreview {...props} file={nextFile} />);
      await screen.findByText('New slide content');
      expect(onLoad).toHaveBeenCalledOnce();

      await act(async () => {
        if (oldResult === 'success') {
          oldThumbnail.resolve('/cache/old.png');
          oldText.resolve('Old slide content');
        } else {
          oldThumbnail.reject(new Error('Old request failed'));
          oldText.resolve('');
        }
      });

      expect(screen.getByRole('img', { name: nextFile.name })).toHaveAttribute(
        'src',
        'asset://localhost/cache/new.png',
      );
      expect(screen.getByText('New slide content')).toBeInTheDocument();
      expect(screen.queryByText('Old slide content')).not.toBeInTheDocument();
      expect(onLoad).toHaveBeenCalledOnce();
      expect(onError).not.toHaveBeenCalled();
    },
  );

  it('invalidates an unfinished attempt when unmounted', async () => {
    const thumbnail = deferred<string | null>();
    const text = deferred<string>();
    vi.mocked(TauriAPI.previewQlThumbnail).mockReturnValueOnce(thumbnail.promise);
    vi.mocked(TauriAPI.extractDocumentText).mockReturnValueOnce(text.promise);
    const { unmount } = render(<QuickLookPreview {...props} />);
    unmount();

    await act(async () => {
      thumbnail.resolve(null);
      text.resolve('');
    });
    expect(onLoad).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
