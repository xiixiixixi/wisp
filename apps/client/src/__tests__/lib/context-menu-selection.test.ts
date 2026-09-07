import { describe, it, expect, vi } from 'vitest';
import {
  ContextMenuFactory,
  type ContextMenuAction,
  type ContextMenuItem,
} from '@/lib/context-menu-factory';
import type { FileEntry } from '@/lib/tauri-api';

vi.mock('@/lib/extension-host', () => ({ extensionHost: { getContextMenuItems: () => [] } }));
vi.mock('@/lib/file-tags-cache', () => ({
  getCachedFileTags: () => [],
  getTagPalette: () => [],
  ensureTagPalette: vi.fn(),
  toggleTagOnFile: vi.fn(),
}));

const files: FileEntry[] = [
  {
    name: 'Archive.v2',
    path: '/work/Archive.v2',
    is_dir: true,
    is_readonly: false,
    size: 0,
    modified: 1,
    file_type: 'folder',
  },
  {
    name: 'README',
    path: '/work/README',
    is_dir: false,
    is_readonly: false,
    size: 120,
    modified: 1,
    file_type: 'text',
  },
];
const findItem = (items: ContextMenuItem[], id: string): ContextMenuItem | undefined =>
  items.find((item) => item.id === id) ??
  items.flatMap((item) => item.submenu ?? []).find((item) => item.id === id);

describe('context menu selection scope', () => {
  it.each([
    ['copy-path', 'copyPath'],
    ['copy-name', 'copyName'],
    ['copy', 'copy'],
    ['cut', 'cut'],
    ['duplicate', 'duplicateFiles'],
    ['bulk-rename', 'bulkRename'],
    ['delete', 'delete'],
    ['compress', 'compressTo'],
    ['properties', 'properties'],
  ] as const)('%s receives all entries with real types and sizes', (id, action) => {
    const handler = vi.fn();
    const actions = { [action]: handler } as unknown as ContextMenuAction;
    const factory = new ContextMenuFactory(actions, {
      resolveFile: (path) => files.find((file) => file.path === path),
    });
    const menu = factory.getFileContextMenu(files[0], new Set(files.map((file) => file.path)));
    const item = findItem(menu, id);
    expect(item).toBeDefined();
    item!.action!();
    expect(handler).toHaveBeenCalledWith(files);
  });
  it('right-clicking outside a selection cannot delete the previous batch', () => {
    const handler = vi.fn();
    const factory = new ContextMenuFactory({ delete: handler } as unknown as ContextMenuAction);
    const other = { ...files[1], path: '/other/file.txt', name: 'file.txt' };
    const menu = factory.getFileContextMenu(other, new Set(files.map((file) => file.path)));
    findItem(menu, 'delete')!.action!();
    expect(handler).toHaveBeenCalledWith([other]);
  });
  it('batch open uses tabs for folders without mistaking extensionless files for folders', () => {
    const openFile = vi.fn();
    const openInNewTab = vi.fn();
    const factory = new ContextMenuFactory(
      { openFile, openInNewTab } as unknown as ContextMenuAction,
      { resolveFile: (path) => files.find((file) => file.path === path) },
    );
    findItem(factory.getFileContextMenu(files[0], new Set(files.map((file) => file.path))), 'open')!
      .action!();
    expect(openInNewTab).toHaveBeenCalledWith(files[0]);
    expect(openFile).toHaveBeenCalledWith(files[1]);
  });
});
