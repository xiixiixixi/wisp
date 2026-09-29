import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HtmlPreview from '@/components/previews/HtmlPreview';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import { convertAssetUrl } from '@/lib/transport';

vi.mock('@/lib/transport', () => ({
  isTauri: () => true,
  convertAssetUrl: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
}));

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    readTextFile: vi.fn(),
    saveTextFile: vi.fn(),
    previewAssetAllowed: vi.fn(),
  },
}));

vi.mock('@/lib/codemirror', () => ({
  WispCodeMirror: ({
    doc,
    editorRef,
    onDocChanged,
  }: {
    doc: string;
    editorRef: React.MutableRefObject<unknown>;
    onDocChanged: () => void;
  }) => {
    const [value, setValue] = React.useState(doc);
    const current = React.useRef(doc);
    React.useEffect(() => {
      editorRef.current = { state: { doc: { toString: () => current.current } } };
      return () => {
        editorRef.current = null;
      };
    }, [editorRef]);
    return (
      <textarea
        aria-label="HTML source"
        value={value}
        onChange={(event) => {
          current.current = event.target.value;
          setValue(event.target.value);
          onDocChanged();
        }}
      />
    );
  },
}));

const file: FileEntry = {
  name: 'index.html',
  path: '/Users/test/我的 网站/index.html',
  size: 128,
  is_dir: false,
  modified: 1234,
  file_type: 'html',
  is_readonly: false,
};

describe('HtmlPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(TauriAPI.readTextFile).mockResolvedValue(
      '<link rel="stylesheet" href="styles.css"><img src="images/cover.png">',
    );
    vi.mocked(TauriAPI.saveTextFile).mockResolvedValue(undefined);
    vi.mocked(TauriAPI.previewAssetAllowed).mockResolvedValue(true);
    vi.mocked(convertAssetUrl).mockImplementation(
      (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
    );
  });

  it('resolves saved HTML resources beside the file and keeps scripts blocked', async () => {
    const { container } = render(<HtmlPreview file={file} />);
    const frame = await waitFor(() => {
      const element = container.querySelector('iframe');
      expect(element?.getAttribute('src')).toContain('/Users/test/');
      return element as HTMLIFrameElement;
    });
    const frameUrl = frame.getAttribute('src')!;

    // The native asset handler drops the first URL slash, then percent-decodes.
    const nativePath = (url: URL) => decodeURIComponent(url.pathname.slice(1));
    expect(nativePath(new URL('styles.css', frameUrl))).toBe('/Users/test/我的 网站/styles.css');
    expect(nativePath(new URL('images/cover.png', frameUrl))).toBe(
      '/Users/test/我的 网站/images/cover.png',
    );
    expect(frame).not.toHaveAttribute('srcdoc');
    expect(frame).toHaveAttribute('sandbox', '');
  });

  it('previews unsaved source and returns to the file URL after saving', async () => {
    const { container } = render(<HtmlPreview file={file} />);
    await waitFor(() => expect(container.querySelector('iframe')).toHaveAttribute('src'));

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'HTML source' }), {
      target: { value: '<h1>Unsaved draft</h1>' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(container.querySelector('iframe')).toHaveAttribute('srcdoc', '<h1>Unsaved draft</h1>');
    expect(container.querySelector('iframe')).not.toHaveAttribute('src');
    expect(container.querySelector('iframe')).toHaveAttribute('sandbox', '');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(TauriAPI.saveTextFile).toHaveBeenCalledWith(file.path, '<h1>Unsaved draft</h1>'),
    );
    await waitFor(() => expect(container.querySelector('iframe')).toHaveAttribute('src'));
    expect(container.querySelector('iframe')).not.toHaveAttribute('srcdoc');
  });

  it('retains the static source preview for files outside the asset scope', async () => {
    vi.mocked(TauriAPI.previewAssetAllowed).mockResolvedValue(false);
    const { container } = render(<HtmlPreview file={file} />);

    await waitFor(() => expect(container.querySelector('iframe')).toHaveAttribute('srcdoc'));
    expect(container.querySelector('iframe')).not.toHaveAttribute('src');
    expect(container.querySelector('iframe')).toHaveAttribute('sandbox', '');
  });

  it('keeps the source readable if the native asset URL cannot be built', async () => {
    vi.mocked(convertAssetUrl).mockReturnValue('not a URL');
    const { container } = render(<HtmlPreview file={file} />);

    await waitFor(() => expect(container.querySelector('iframe')).toHaveAttribute('srcdoc'));
    expect(container.querySelector('iframe')).not.toHaveAttribute('src');
  });

  it("never uses the previous file's permission for a newly selected path", async () => {
    let finishScopeCheck!: (allowed: boolean) => void;
    vi.mocked(TauriAPI.previewAssetAllowed)
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finishScopeCheck = resolve;
          }),
      );
    const { container, rerender } = render(<HtmlPreview file={file} />);
    await waitFor(() => expect(container.querySelector('iframe')).toHaveAttribute('src'));

    rerender(<HtmlPreview file={{ ...file, path: '/Volumes/external/index.html' }} />);
    expect(container.querySelector('iframe')).toBeNull();
    finishScopeCheck(false);
    await waitFor(() => expect(container.querySelector('iframe')).toHaveAttribute('srcdoc'));
    expect(container.querySelector('iframe')).not.toHaveAttribute('src');
  });
});
