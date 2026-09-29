import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuickLookPreview from '@/components/previews/QuickLookPreview';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import { isMacPlatform } from '@/lib/shortcut-utils';
import { isTauri } from '@/lib/transport';

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    previewMountQlView: vi.fn(),
    previewUpdateQlView: vi.fn(),
    previewCloseQlView: vi.fn(),
    previewQlThumbnail: vi.fn(),
    extractDocumentText: vi.fn(),
    previewOpenQlPanel: vi.fn(),
    previewOpenQlPreview: vi.fn(),
  },
}));
vi.mock('@/lib/transport', () => ({
  isTauri: vi.fn(() => true),
  convertAssetUrl: (path: string) => `asset://localhost${path}`,
}));
vi.mock('@/lib/shortcut-utils', () => ({ isMacPlatform: vi.fn(() => true) }));

const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const rect = (x: number, y: number, width: number, height: number) =>
  ({
    x,
    y,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    width,
    height,
    toJSON: () => ({}),
  }) as DOMRect;

const file: FileEntry = {
  name: 'Slides.pptx',
  path: '/Documents/Slides.pptx',
  size: 1024,
  modified: 1,
  is_dir: false,
  is_readonly: false,
  file_type: 'presentation',
};
const nextFile = { ...file, name: 'Next.pptx', path: '/Documents/Next.pptx' };

describe('native presentation sidebar lifecycle', () => {
  let hostRect: DOMRect;
  let resizeCallbacks: Array<() => void>;
  let disconnects: Array<ReturnType<typeof vi.fn>>;
  let pendingRequests: Array<ReturnType<typeof deferred>>;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(isMacPlatform).mockReturnValue(true);
    vi.mocked(TauriAPI.previewMountQlView).mockResolvedValue(undefined);
    vi.mocked(TauriAPI.previewUpdateQlView).mockResolvedValue(undefined);
    vi.mocked(TauriAPI.previewCloseQlView).mockResolvedValue(undefined);
    vi.mocked(TauriAPI.previewQlThumbnail).mockResolvedValue('/cache/slides.png');
    vi.mocked(TauriAPI.extractDocumentText).mockResolvedValue('Slide content');
    vi.mocked(TauriAPI.previewOpenQlPanel).mockResolvedValue(undefined);
    vi.mocked(TauriAPI.previewOpenQlPreview).mockResolvedValue(undefined);

    hostRect = rect(600, 80, 400, 500);
    resizeCallbacks = [];
    disconnects = [];
    pendingRequests = [];
    vi.stubGlobal(
      'ResizeObserver',
      vi.fn().mockImplementation((callback: () => void) => {
        const disconnect = vi.fn();
        resizeCallbacks.push(callback);
        disconnects.push(disconnect);
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect };
      }),
    );
    // jsdom has no layout engine. Supply actual non-zero geometry to exercise
    // the visible native frame contract instead of accidentally testing hidden views.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.hasAttribute('data-native-document')) return hostRect;
      return rect(0, 0, window.innerWidth, window.innerHeight);
    });
  });

  afterEach(async () => {
    cleanup();
    // Let queued session cleanup finish before resetting mocks for the next case.
    await act(async () => pendingRequests.forEach((request) => request.resolve()));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const waitForAttachment = async () => {
    await waitFor(() => expect(TauriAPI.previewMountQlView).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Loading preview' })).not.toBeInTheDocument(),
    );
    return vi.mocked(TauriAPI.previewMountQlView).mock.calls[0][1];
  };

  it.each(['ppt', 'PPTX', 'pps', 'ppsx'])(
    'embeds %s in the sidebar without a cover extraction or external preview window',
    async (extension) => {
      const presentation = {
        ...file,
        name: `Slides.${extension}`,
        path: `/Documents/Slides.${extension}`,
      };
      const onLoad = vi.fn();
      const { container } = render(<QuickLookPreview file={presentation} onLoad={onLoad} />);
      const sessionId = await waitForAttachment();

      expect(TauriAPI.previewMountQlView).toHaveBeenCalledWith(
        presentation.path,
        sessionId,
        {
          x: 600,
          y: 80,
          width: 400,
          height: 500,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        },
        true,
      );
      expect(container.querySelector('[data-native-document]')).toHaveAttribute(
        'data-native-document',
        presentation.path,
      );
      expect(TauriAPI.previewQlThumbnail).not.toHaveBeenCalled();
      expect(TauriAPI.extractDocumentText).not.toHaveBeenCalled();
      expect(TauriAPI.previewOpenQlPanel).not.toHaveBeenCalled();
      expect(TauriAPI.previewOpenQlPreview).not.toHaveBeenCalled();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      // Attaching a native host does not prove that the operating system has
      // finished loading slides, so it must not report that through onLoad.
      expect(onLoad).not.toHaveBeenCalled();
    },
  );

  it('updates the existing session when the sidebar resizes or scrolls', async () => {
    render(<QuickLookPreview file={file} />);
    const sessionId = await waitForAttachment();

    hostRect = rect(650, 100, 320, 420);
    act(() => resizeCallbacks.forEach((callback) => callback()));
    await waitFor(() =>
      expect(TauriAPI.previewUpdateQlView).toHaveBeenLastCalledWith(
        sessionId,
        expect.objectContaining({ x: 650, y: 100, width: 320, height: 420 }),
        true,
      ),
    );

    hostRect = rect(650, -40, 320, 420);
    fireEvent.scroll(document);
    await waitFor(() =>
      expect(TauriAPI.previewUpdateQlView).toHaveBeenLastCalledWith(
        sessionId,
        expect.objectContaining({ x: 650, y: 0, width: 320, height: 380 }),
        true,
      ),
    );
    expect(TauriAPI.previewMountQlView).toHaveBeenCalledTimes(1);
    expect(TauriAPI.previewCloseQlView).not.toHaveBeenCalled();
  });

  it.each(['dialog', 'menu', 'region'])(
    'temporarily hides the same session behind a %s and restores it without reloading slides',
    async (role) => {
      const { rerender } = render(<QuickLookPreview file={file} />);
      const sessionId = await waitForAttachment();

      rerender(
        <>
          <QuickLookPreview file={file} />
          <div role={role} id={role === 'region' ? 'wisp-bottom-right-overlay-stack' : undefined}>
            Overlay controls
          </div>
        </>,
      );
      await waitFor(() =>
        expect(TauriAPI.previewUpdateQlView).toHaveBeenLastCalledWith(
          sessionId,
          expect.any(Object),
          false,
        ),
      );
      rerender(<QuickLookPreview file={file} />);
      await waitFor(() =>
        expect(TauriAPI.previewUpdateQlView).toHaveBeenLastCalledWith(
          sessionId,
          expect.any(Object),
          true,
        ),
      );
      expect(TauriAPI.previewMountQlView).toHaveBeenCalledTimes(1);
      expect(TauriAPI.previewCloseQlView).not.toHaveBeenCalled();
    },
  );

  it('keeps the preview visible beside the file list and hides it only when the list overlaps', async () => {
    let listRect = rect(0, 80, 560, 500);
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function () {
      if (this.getAttribute('role') === 'listbox') return listRect;
      if (this.hasAttribute('data-native-document')) return hostRect;
      return rect(0, 0, window.innerWidth, window.innerHeight);
    });
    const { rerender } = render(
      <>
        <div role="listbox" aria-label="Files" style={{ width: 560 }} />
        <QuickLookPreview file={file} />
      </>,
    );
    const sessionId = await waitForAttachment();
    expect(TauriAPI.previewMountQlView).toHaveBeenCalledWith(
      file.path,
      sessionId,
      expect.objectContaining({ x: 600, width: 400 }),
      true,
    );

    listRect = rect(0, 80, 700, 500);
    rerender(
      <>
        <div role="listbox" aria-label="Files" style={{ width: 700 }} />
        <QuickLookPreview file={file} />
      </>,
    );
    await waitFor(() =>
      expect(TauriAPI.previewUpdateQlView).toHaveBeenLastCalledWith(
        sessionId,
        expect.any(Object),
        false,
      ),
    );
    expect(TauriAPI.previewMountQlView).toHaveBeenCalledTimes(1);
    expect(TauriAPI.previewCloseQlView).not.toHaveBeenCalled();
  });

  it('hides an ancestor-collapsed sidebar without discarding its current session', async () => {
    const { rerender } = render(
      <section aria-hidden="false">
        <QuickLookPreview file={file} />
      </section>,
    );
    const sessionId = await waitForAttachment();
    rerender(
      <section aria-hidden="true">
        <QuickLookPreview file={file} />
      </section>,
    );

    await waitFor(() =>
      expect(TauriAPI.previewUpdateQlView).toHaveBeenLastCalledWith(
        sessionId,
        expect.any(Object),
        false,
      ),
    );
    expect(TauriAPI.previewMountQlView).toHaveBeenCalledTimes(1);
    expect(TauriAPI.previewCloseQlView).not.toHaveBeenCalled();
  });

  it('closes its own session and disconnects layout observers when the sidebar unmounts', async () => {
    const { unmount } = render(<QuickLookPreview file={file} />);
    const sessionId = await waitForAttachment();
    unmount();

    await waitFor(() => expect(TauriAPI.previewCloseQlView).toHaveBeenCalledWith(sessionId));
    expect(disconnects.every((disconnect) => disconnect.mock.calls.length === 1)).toBe(true);
    const previousUpdates = vi.mocked(TauriAPI.previewUpdateQlView).mock.calls.length;
    act(() => resizeCallbacks.forEach((callback) => callback()));
    fireEvent.resize(window);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(TauriAPI.previewUpdateQlView).toHaveBeenCalledTimes(previousUpdates);
    expect(TauriAPI.previewMountQlView).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve', 'reject'] as const)(
    'finishes and closes an old pending attachment before mounting the next file (%s)',
    async (oldResult) => {
      const oldMount = deferred();
      const newMount = deferred();
      pendingRequests.push(oldMount, newMount);
      vi.mocked(TauriAPI.previewMountQlView)
        .mockReturnValueOnce(oldMount.promise)
        .mockReturnValueOnce(newMount.promise);
      const { rerender, container } = render(<QuickLookPreview file={file} />);
      await waitFor(() => expect(TauriAPI.previewMountQlView).toHaveBeenCalledTimes(1));
      const oldSession = vi.mocked(TauriAPI.previewMountQlView).mock.calls[0][1];

      rerender(<QuickLookPreview file={nextFile} />);
      await act(async () => {});
      expect(TauriAPI.previewMountQlView).toHaveBeenCalledTimes(1);
      expect(TauriAPI.previewCloseQlView).not.toHaveBeenCalled();

      await act(async () => {
        if (oldResult === 'resolve') oldMount.resolve();
        else oldMount.reject(new Error('Old file could not attach'));
      });
      await waitFor(() => expect(TauriAPI.previewMountQlView).toHaveBeenCalledTimes(2));
      const newSession = vi.mocked(TauriAPI.previewMountQlView).mock.calls[1][1];
      expect(newSession).not.toBe(oldSession);
      expect(TauriAPI.previewCloseQlView).toHaveBeenCalledOnce();
      expect(TauriAPI.previewCloseQlView).toHaveBeenCalledWith(oldSession);
      expect(vi.mocked(TauriAPI.previewCloseQlView).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(TauriAPI.previewMountQlView).mock.invocationCallOrder[1],
      );
      expect(TauriAPI.previewMountQlView).toHaveBeenLastCalledWith(
        nextFile.path,
        newSession,
        expect.any(Object),
        true,
      );
      expect(container.querySelector('[data-native-document]')).toHaveAttribute(
        'data-native-document',
        nextFile.path,
      );
      expect(screen.getByRole('status', { name: 'Loading preview' })).toBeInTheDocument();

      await act(async () => newMount.resolve());
      await waitFor(() =>
        expect(screen.queryByRole('status', { name: 'Loading preview' })).not.toBeInTheDocument(),
      );
      expect(TauriAPI.previewCloseQlView).not.toHaveBeenCalledWith(newSession);
      expect(TauriAPI.previewQlThumbnail).not.toHaveBeenCalled();
      expect(TauriAPI.extractDocumentText).not.toHaveBeenCalled();
    },
  );

  it('falls back to the thumbnail and text when native attachment fails', async () => {
    const failure = new Error('Native host unavailable');
    vi.mocked(TauriAPI.previewMountQlView).mockRejectedValueOnce(failure);
    const onLoad = vi.fn();
    const onError = vi.fn();
    render(<QuickLookPreview file={file} onLoad={onLoad} onError={onError} />);

    expect(await screen.findByRole('img', { name: file.name })).toHaveAttribute(
      'src',
      'asset://localhost/cache/slides.png',
    );
    expect(screen.getByText('Slide content')).toBeInTheDocument();
    expect(TauriAPI.previewQlThumbnail).toHaveBeenCalledWith(file.path, 1600);
    expect(TauriAPI.extractDocumentText).toHaveBeenCalledWith(file.path);
    const failedSession = vi.mocked(TauriAPI.previewMountQlView).mock.calls[0][1];
    expect(TauriAPI.previewCloseQlView).toHaveBeenCalledWith(failedSession);
    expect(onLoad).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(TauriAPI.previewOpenQlPanel).not.toHaveBeenCalled();
  });

  it('keeps non-presentation formats on the existing thumbnail and system-preview flow', async () => {
    const model = { ...file, name: 'Model.usdz', path: '/Documents/Model.usdz' };
    render(<QuickLookPreview file={model} />);

    expect(await screen.findByRole('img', { name: model.name })).toBeInTheDocument();
    expect(TauriAPI.previewMountQlView).not.toHaveBeenCalled();
    expect(TauriAPI.extractDocumentText).not.toHaveBeenCalled();
    expect(TauriAPI.previewQlThumbnail).toHaveBeenCalledWith(model.path, 1600);
    fireEvent.click(screen.getByRole('button', { name: 'Open in Quick Look' }));
    await waitFor(() => expect(TauriAPI.previewOpenQlPanel).toHaveBeenCalledWith(model.path));
  });

  it('does not call the macOS embedding bridge outside the desktop Mac app', async () => {
    vi.mocked(isMacPlatform).mockReturnValue(false);
    const { unmount } = render(<QuickLookPreview file={file} />);
    await screen.findByRole('img', { name: file.name });
    expect(TauriAPI.previewMountQlView).not.toHaveBeenCalled();
    unmount();

    vi.mocked(isMacPlatform).mockReturnValue(true);
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(TauriAPI.previewQlThumbnail).mockClear();
    render(<QuickLookPreview file={file} />);
    expect(TauriAPI.previewMountQlView).not.toHaveBeenCalled();
    expect(TauriAPI.previewQlThumbnail).not.toHaveBeenCalled();
  });
});
