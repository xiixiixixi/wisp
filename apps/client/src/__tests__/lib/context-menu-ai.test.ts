/**
 * Context-menu AI quick actions — the wisp-open-chat bridge.
 */
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

const file: FileEntry = {
  name: 'report.pdf',
  path: '/work/report.pdf',
  is_dir: false,
  is_readonly: false,
  size: 1200,
  modified: 1,
  file_type: 'pdf',
};

const folder: FileEntry = {
  name: '发票',
  path: '/work/发票',
  is_dir: true,
  is_readonly: false,
  size: 0,
  modified: 1,
  file_type: 'folder',
};

const flatten = (items: ContextMenuItem[]): ContextMenuItem[] =>
  items.flatMap((item) => [item, ...(item.submenu ?? [])]);

describe('context menu AI actions', () => {
  it('offers summarize/explain/rename for a single file', () => {
    const factory = new ContextMenuFactory({} as ContextMenuAction);
    const items = flatten(factory.getFileContextMenu(file, new Set()));
    expect(items.find((i) => i.id === 'ai-actions')).toBeDefined();
    expect(items.find((i) => i.id === 'ai-summarize')).toBeDefined();
    expect(items.find((i) => i.id === 'ai-explain')).toBeDefined();
    expect(items.find((i) => i.id === 'ai-rename')).toBeDefined();
    expect(items.find((i) => i.id === 'ai-organize')).toBeUndefined();
  });

  it('offers organize for a folder instead of file actions', () => {
    const factory = new ContextMenuFactory({} as ContextMenuAction);
    const items = flatten(factory.getFileContextMenu(folder, new Set()));
    expect(items.find((i) => i.id === 'ai-organize')).toBeDefined();
    expect(items.find((i) => i.id === 'ai-summarize')).toBeUndefined();
  });

  it('dispatches wisp-open-chat with the templated prompt', () => {
    const dispatch = vi.fn();
    vi.stubGlobal('dispatchEvent', dispatch);
    const factory = new ContextMenuFactory({} as ContextMenuAction);
    const items = flatten(factory.getFileContextMenu(file, new Set()));
    const summarize = items.find((i) => i.id === 'ai-summarize');
    summarize?.action?.();
    expect(dispatch).toHaveBeenCalled();
    const event = dispatch.mock.calls[0][0] as CustomEvent<{ prompt: string }>;
    expect(event.type).toBe('wisp-open-chat');
    expect(event.detail.prompt).toContain('report.pdf');
    vi.unstubAllGlobals();
  });

  it('hides AI actions on multi-select', () => {
    const factory = new ContextMenuFactory({} as ContextMenuAction);
    const items = flatten(
      factory.getFileContextMenu(file, new Set(['/work/report.pdf', '/work/other.pdf'])),
    );
    expect(items.find((i) => i.id === 'ai-actions')).toBeUndefined();
  });
});
