import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectionCommands } from '@/lib/selection-commands';
import { copyEntryText } from '@/lib/copy-entry-text';
import { getKeyString } from '@/lib/shortcut-utils';
import type { ContextMenuAction } from '@/lib/context-menu-factory';
import type { FileEntry } from '@/lib/tauri-api';

const files: FileEntry[] = [
  {
    path: '/工作/方案 A.txt',
    name: '方案 A.txt',
    is_dir: false,
    is_readonly: false,
    size: 10,
    modified: 1,
    file_type: 'text',
  },
  {
    path: '/工作/资料',
    name: '资料',
    is_dir: true,
    is_readonly: false,
    size: 0,
    modified: 1,
    file_type: 'folder',
  },
  {
    path: '/工作/预算.csv',
    name: '预算.csv',
    is_dir: false,
    is_readonly: false,
    size: 20,
    modified: 1,
    file_type: 'csv',
  },
];

describe('selection commands', () => {
  const actions = {
    properties: vi.fn(),
    copyPath: vi.fn(),
    duplicateFiles: vi.fn(),
    openInNewTab: vi.fn(),
    openFile: vi.fn(),
    bulkRename: vi.fn(),
  } as unknown as ContextMenuAction;
  const openSingle = vi.fn();
  beforeEach(() => vi.clearAllMocks());

  it('routes Option+Command+C, including the macOS Option glyph, to every path', () => {
    expect(
      getKeyString(
        new KeyboardEvent('keydown', { key: 'ç', code: 'KeyC', metaKey: true, altKey: true }),
      ),
    ).toBe('ctrl+alt+c');
    selectionCommands(new Set(files.map((f) => f.path)), files, actions, openSingle).copyPath();
    expect(actions.copyPath).toHaveBeenCalledWith(files);
  });
  it('does not lose paths during a file-list refresh', () => {
    selectionCommands(new Set(files.map((f) => f.path)), [], actions, openSingle).copyPath();
    expect(vi.mocked(actions.copyPath).mock.calls[0][0]).toEqual(
      files.map((file) => expect.objectContaining({ path: file.path, name: file.name })),
    );
  });
  it('duplicates the entire selection using the same collision-safe action as the menu', () => {
    selectionCommands(new Set(files.map((f) => f.path)), files, actions, openSingle).duplicate();
    expect(actions.duplicateFiles).toHaveBeenCalledWith(files);
  });
  it('opens selected files and gives selected folders their own tabs', () => {
    selectionCommands(new Set(files.map((f) => f.path)), files, actions, openSingle).open();
    expect(actions.openFile).toHaveBeenCalledTimes(2);
    expect(actions.openFile).toHaveBeenCalledWith(files[0]);
    expect(actions.openFile).toHaveBeenCalledWith(files[2]);
    expect(actions.openInNewTab).toHaveBeenCalledWith(files[1]);
    expect(openSingle).not.toHaveBeenCalled();
  });
  it('preserves ordinary single-item opening', () => {
    selectionCommands(new Set([files[1].path]), files, actions, openSingle).open();
    expect(openSingle).toHaveBeenCalledWith(files[1]);
    expect(actions.openInNewTab).not.toHaveBeenCalled();
  });
  it('uses the bulk rename dialog for multiple items', () => {
    selectionCommands(new Set(files.map((f) => f.path)), files, actions, openSingle).rename();
    expect(actions.bulkRename).toHaveBeenCalledWith(files);
  });
  it('shows properties for the entire selection', () => {
    selectionCommands(new Set(files.map((f) => f.path)), files, actions, openSingle).properties();
    expect(actions.properties).toHaveBeenCalledWith(files);
  });
  it('does nothing for an empty selection', () => {
    const commands = selectionCommands(new Set(), files, actions, openSingle);
    Object.values(commands).forEach((command) => command());
    Object.values(actions).forEach((action) => expect(action).not.toHaveBeenCalled());
  });
});

describe('text clipboard feedback', () => {
  const writeText = vi.fn();
  const toast = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    writeText.mockResolvedValue(undefined);
  });
  it.each(['path', 'name'] as const)('copies every %s on its own line', async (field) => {
    await copyEntryText(files, field, toast);
    expect(writeText).toHaveBeenCalledWith(files.map((file) => file[field]).join('\n'));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0].description).toContain('3');
  });
  it('waits for the clipboard before announcing success', async () => {
    let resolve!: () => void;
    writeText.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    const pending = copyEntryText(files, 'path', toast);
    expect(toast).not.toHaveBeenCalled();
    resolve();
    await pending;
    expect(toast).toHaveBeenCalledTimes(1);
  });
  it('reports clipboard failures without a success message', async () => {
    writeText.mockRejectedValue(new Error('Clipboard denied'));
    await copyEntryText(files, 'path', toast);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive', description: 'Clipboard denied' }),
    );
  });
  it('still accepts a single entry', async () => {
    await copyEntryText(files[0], 'path', toast);
    expect(writeText).toHaveBeenCalledWith(files[0].path);
  });
});
