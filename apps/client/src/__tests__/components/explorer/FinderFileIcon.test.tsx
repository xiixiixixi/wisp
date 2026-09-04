import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { FileEntry } from '@/lib/tauri-api';
import FinderFileIcon from '@/components/explorer/FinderFileIcon';

const mocks = vi.hoisted(() => ({
  demoMode: vi.fn(() => false),
  isTauri: vi.fn(() => true),
  getFileThumbnailPng: vi.fn(),
  convertAssetUrl: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock('@/lib/browser-demo-files', () => ({
  isBrowserDemoMode: mocks.demoMode,
}));

vi.mock('@/lib/transport', () => ({
  isTauri: mocks.isTauri,
  convertAssetUrl: mocks.convertAssetUrl,
}));

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    getFileThumbnailPng: mocks.getFileThumbnailPng,
  },
}));

const makeFile = (name: string, overrides: Partial<FileEntry> = {}): FileEntry => ({
  name,
  path: `/Users/test/Documents/${name}`,
  is_dir: false,
  size: 2048,
  modified: 1_725_000_000,
  file_type: name.split('.').pop() ?? 'file',
  is_readonly: false,
  ...overrides,
});

class TestIntersectionObserver implements IntersectionObserver {
  static instances: TestIntersectionObserver[] = [];

  readonly root = null;
  readonly rootMargin = '160px';
  readonly thresholds = [0];
  private element: Element | null = null;

  constructor(private readonly callback: IntersectionObserverCallback) {
    TestIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.element = element;
    this.emit(true);
  }

  emit(isIntersecting: boolean) {
    if (!this.element) return;
    this.callback([{ isIntersecting, target: this.element } as IntersectionObserverEntry], this);
  }

  observesPath(path: string) {
    return this.element?.getAttribute('data-finder-file-icon') === path;
  }

  disconnect() {
    this.element = null;
  }

  unobserve(element: Element) {
    if (this.element === element) this.element = null;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

describe('FinderFileIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.demoMode.mockReturnValue(false);
    mocks.isTauri.mockReturnValue(true);
    mocks.convertAssetUrl.mockImplementation((path: string) => `asset://${path}`);
    TestIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the file itself as the preview for web-native images', async () => {
    const file = makeFile('photo.png');
    const { container } = render(
      <FinderFileIcon file={file} fallback={<span data-testid="fallback">fallback</span>} />,
    );

    await waitFor(() => expect(container.querySelector('img')).toBeInTheDocument());
    expect(container.querySelector('img')).toHaveAttribute('src', `asset://${file.path}`);
    expect(mocks.getFileThumbnailPng).not.toHaveBeenCalled();
  });

  it('uses Quick Look output for PDFs and other previewable documents', async () => {
    const file = makeFile('guide.pdf');
    mocks.getFileThumbnailPng.mockResolvedValue('/app-data/finder-thumbnails/guide.png');
    const { container } = render(
      <FinderFileIcon file={file} fallback={<span data-testid="fallback">fallback</span>} />,
    );

    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('img')).toBeInTheDocument());
    expect(mocks.getFileThumbnailPng).toHaveBeenCalledWith(file.path, 96);
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'asset:///app-data/finder-thumbnails/guide.png',
    );
  });

  it('keeps the semantic fallback when native thumbnail generation fails', async () => {
    const file = makeFile('unsupported.xyz');
    mocks.getFileThumbnailPng.mockRejectedValue(new Error('no provider'));
    render(<FinderFileIcon file={file} fallback={<span data-testid="fallback">fallback</span>} />);

    await waitFor(() => expect(mocks.getFileThumbnailPng).toHaveBeenCalled());
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('deduplicates native work for multiple subscribers of the same file', async () => {
    const file = makeFile('shared-preview.pdf');
    mocks.getFileThumbnailPng.mockResolvedValue('/cache/shared-preview.png');
    const { container } = render(
      <>
        <FinderFileIcon file={file} fallback={<span>fallback</span>} />
        <FinderFileIcon file={file} fallback={<span>fallback</span>} />
      </>,
    );

    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(2));
    expect(mocks.getFileThumbnailPng).toHaveBeenCalledTimes(1);
  });

  it('does not call native APIs for remote provider paths', async () => {
    const file = makeFile('remote.pdf', { path: 'gdrive://documents/remote.pdf' });
    render(<FinderFileIcon file={file} fallback={<span data-testid="fallback">fallback</span>} />);

    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    await Promise.resolve();
    expect(mocks.getFileThumbnailPng).not.toHaveBeenCalled();
  });

  it('renders deterministic Finder-like browser-demo visuals', () => {
    mocks.demoMode.mockReturnValue(true);
    const pdf = makeFile('Brand-guidelines.pdf');
    const folder = makeFile('Launch', { is_dir: true, file_type: 'folder' });
    const { container, rerender } = render(
      <FinderFileIcon file={pdf} fallback={<span>fallback</span>} />,
    );

    expect(container.querySelector('[data-demo-file-visual="pdf"]')).toBeInTheDocument();
    rerender(<FinderFileIcon file={folder} fallback={<span>fallback</span>} />);
    expect(container.querySelector('[data-demo-file-visual="folder"]')).toBeInTheDocument();
    expect(mocks.getFileThumbnailPng).not.toHaveBeenCalled();
  });

  it('cancels a queued thumbnail when its icon leaves the observed range', async () => {
    const files = Array.from({ length: 6 }, (_, index) => makeFile(`queued-${index + 1}.pdf`));
    const resolvers = new Map<string, (value: string) => void>();
    mocks.getFileThumbnailPng.mockImplementation(
      (path: string) =>
        new Promise<string>((resolve) => {
          resolvers.set(path, resolve);
        }),
    );

    const { unmount } = render(
      <>
        {files.map((file) => (
          <FinderFileIcon key={file.path} file={file} fallback={<span>fallback</span>} />
        ))}
      </>,
    );

    await waitFor(() => expect(mocks.getFileThumbnailPng).toHaveBeenCalledTimes(4));
    const cancelledFile = files[4];
    const nextFile = files[5];
    const cancelledObserver = TestIntersectionObserver.instances.find((observer) =>
      observer.observesPath(cancelledFile.path),
    );
    expect(cancelledObserver).toBeDefined();

    act(() => cancelledObserver?.emit(false));
    await act(async () => {
      resolvers.get(files[0].path)?.(`/cache/${files[0].name}.png`);
      await Promise.resolve();
    });

    await waitFor(() => expect(mocks.getFileThumbnailPng).toHaveBeenCalledTimes(5));
    expect(mocks.getFileThumbnailPng).not.toHaveBeenCalledWith(cancelledFile.path, 96);
    expect(mocks.getFileThumbnailPng).toHaveBeenCalledWith(nextFile.path, 96);

    unmount();
    await act(async () => {
      for (const [path, resolve] of resolvers) resolve(`/cache/${path.split('/').pop()}.png`);
      await Promise.resolve();
    });
  });
});
