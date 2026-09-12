import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PlistPreview from '@/components/previews/PlistPreview';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';

vi.mock('@/lib/transport', () => ({ isTauri: () => true }));
vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    previewPlistXml: vi.fn(async () => '<plist><string>Wisp</string></plist>'),
    readTextFile: vi.fn(),
  },
}));
vi.mock('@/lib/codemirror', () => ({
  WispCodeMirror: ({ doc, readOnly }: { doc: string; readOnly: boolean }) => (
    <div role="textbox" aria-readonly={readOnly}>
      {doc}
    </div>
  ),
}));

describe('PlistPreview', () => {
  it('exposes converted property lists as read-only previews for adjacent-file navigation', async () => {
    const file: FileEntry = {
      name: 'Info.plist',
      path: '/Info.plist',
      size: 128,
      is_dir: false,
      modified: 0,
      file_type: 'plist',
    };
    render(<PlistPreview file={file} />);

    const editor = await screen.findByRole('textbox');
    expect(editor).toHaveTextContent('<plist><string>Wisp</string></plist>');
    expect(editor).toHaveAttribute('aria-readonly', 'true');
    expect(editor.closest('[data-preview-readonly]')).toHaveAttribute(
      'data-preview-readonly',
      'true',
    );
    expect(TauriAPI.previewPlistXml).toHaveBeenCalledWith(file.path);
    expect(TauriAPI.readTextFile).not.toHaveBeenCalled();
  });
});
