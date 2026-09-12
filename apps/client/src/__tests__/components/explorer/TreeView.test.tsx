import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FileEntry } from '@/lib/tauri-api';
import { requestAdjacentFile } from '@/lib/file-navigation';
import TreeView from '@/components/explorer/TreeView';

const mocks = vi.hoisted(() => ({ readDirectory: vi.fn() }));
vi.mock('@/lib/tauri-api', () => ({ TauriAPI: { readDirectory: mocks.readDirectory } }));
vi.mock('@/hooks/use-draggable', () => ({ useDraggable: () => ({}) }));
vi.mock('@/components/explorer/FileReferenceBadge', () => ({
  FileReferenceBadge: ({ children }: { children: React.ReactNode }) => children,
}));

const entry = (path: string, is_dir = false): FileEntry => ({
  path,
  name: path.split('/').at(-1)!,
  is_dir,
  size: 10,
  modified: 0,
  file_type: 'file',
});
const folder = entry('/files/folder', true);
const rootFile = entry('/files/root.txt');
const nestedFolder = entry('/files/folder/nested', true);
const childA = entry('/files/folder/a.txt');
const childZ = entry('/files/folder/z.txt');
const nestedFile = entry('/files/folder/nested/inside.txt');
const props = {
  files: [rootFile, folder],
  selectedFiles: new Set<string>(),
  currentPath: '/files',
  groupId: 'one',
  getFileIcon: () => 'file',
  formatFileSize: () => '10 B',
  formatFolderSize: () => '',
  formatDate: () => '',
  handleFileClick: vi.fn(),
  handleFileDoubleClick: vi.fn(),
  handleFileRightClick: vi.fn(),
  getFolderSize: () => null,
  isCalculatingSize: () => false,
};

describe('TreeView adjacent navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readDirectory.mockImplementation((path: string) =>
      Promise.resolve(path === folder.path ? [childZ, childA, nestedFolder] : [nestedFile]),
    );
  });

  it('uses directory-first sorted rows for keyboard selection and focus', async () => {
    render(<TreeView {...props} />);
    const rows = screen.getAllByRole('treeitem');
    expect(rows.map((row) => row.dataset.filePath)).toEqual([folder.path, rootFile.path]);
    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
    expect(props.handleFileClick).toHaveBeenLastCalledWith(rootFile, expect.anything());
    await waitFor(() => expect(rows[1]).toHaveFocus());
    fireEvent.keyDown(rows[1], { key: 'ArrowUp' });
    expect(props.handleFileClick).toHaveBeenLastCalledWith(folder, expect.anything());
    await waitFor(() => expect(rows[0]).toHaveFocus());
    expect(mocks.readDirectory).not.toHaveBeenCalled();
  });

  it('serves expanded descendants in their rendered order and excludes collapsed descendants', async () => {
    render(<TreeView {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand folder' }));
    await screen.findByText('a.txt');
    fireEvent.click(screen.getByRole('button', { name: 'Expand nested' }));
    await screen.findByText('inside.txt');
    const visible = [folder, nestedFolder, nestedFile, childA, childZ, rootFile];
    expect(screen.getAllByRole('treeitem').map((row) => row.dataset.filePath)).toEqual(
      visible.map((file) => file.path),
    );
    const overlayControl = document.createElement('button');
    document.body.append(overlayControl);
    overlayControl.focus();
    act(() => expect(requestAdjacentFile(nestedFile.path, 1)).toBe(childA));
    expect(props.handleFileClick).toHaveBeenLastCalledWith(childA, expect.anything());
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(overlayControl).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse nested' }));
    act(() => expect(requestAdjacentFile(nestedFolder.path, 1)).toBe(childA));
    expect(requestAdjacentFile(nestedFile.path, 1)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse folder' }));
    act(() => expect(requestAdjacentFile(folder.path, 1)).toBe(rootFile));
    expect(requestAdjacentFile(childA.path, 1)).toBeNull();
    overlayControl.remove();
  });

  it('does not let an inactive pane respond to a Quick Look request', () => {
    render(
      <div data-active="false">
        <TreeView {...props} />
      </div>,
    );
    expect(requestAdjacentFile(folder.path, 1)).toBeNull();
    expect(props.handleFileClick).not.toHaveBeenCalled();
  });
});
