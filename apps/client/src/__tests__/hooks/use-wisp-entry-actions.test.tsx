import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { useWispActions, type WispActionsDeps } from '@/hooks/use-wisp-actions';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-navigation-actions', () => ({
  useNavigationActions: () => ({ navigateWithHistory: navigate }),
}));
vi.mock('@/hooks/use-file-actions', () => ({ useFileActions: () => ({}) }));
vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    openFile: vi.fn(),
    addRecentFile: vi.fn(),
    isDir: vi.fn(),
    getUserDirectories: vi.fn(),
  },
}));
vi.mock('@/lib/browser-demo-files', async (original) => ({
  ...(await original<typeof import('@/lib/browser-demo-files')>()),
  isBrowserDemoMode: () => false,
}));

const file: FileEntry = {
  path: '/notes.txt',
  name: 'notes.txt',
  is_dir: false,
  file_type: 'txt',
  size: 20,
  modified: 0,
  is_readonly: false,
};

const dependencies = (currentPath: string, files: FileEntry[] = []) =>
  ({
    currentPath,
    files,
    splitLayout: {},
    activeGroup: { id: 'main' },
    selectedFiles: new Set(),
    setSelectedFiles: vi.fn(),
    setSelectedFile: vi.fn(),
    setRightPanelTab: vi.fn(),
    setRightSidebarCollapsed: vi.fn(),
    pendingSelectRef: { current: null },
    refetch: vi.fn(),
    toast: vi.fn(),
    fileOps: { renameFileInline: vi.fn(), contextMenuActions: {} },
    ctxMenu: {},
    dialogManager: {},
    crossTabSelection: {},
    paneRefetchRef: { current: vi.fn() },
  }) as unknown as WispActionsDeps;

beforeEach(() => vi.clearAllMocks());

describe('shared inspector preview integration', () => {
  it('keeps toolbar and home previews open while replacing the file without navigating or opening externally', () => {
    const deps = dependencies('/Projects');
    const nextFile = { ...file, name: 'other.txt', path: '/Elsewhere/other.txt' };
    const { result } = renderHook(() => {
      const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
      const [selectedFiles, setSelectedFiles] = useState(new Set(['/previous.txt', '/older.txt']));
      const [rightPanelTab, setRightPanelTab] = useState('details');
      const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(true);
      const actions = useWispActions({
        ...deps,
        selectedFiles,
        setSelectedFile,
        setSelectedFiles,
        rightSidebarCollapsed,
        setRightPanelTab,
        setRightSidebarCollapsed,
      });
      return { actions, selectedFile, selectedFiles, rightPanelTab, rightSidebarCollapsed };
    });

    act(() => result.current.actions.handlePreviewFile(file));
    expect(result.current.selectedFile).toBe(file);
    expect(result.current.selectedFiles).toEqual(new Set([file.path]));
    expect(result.current.rightPanelTab).toBe('preview');
    expect(result.current.rightSidebarCollapsed).toBe(false);

    act(() => result.current.actions.sharedActions.onQuickLook?.(file));
    expect(result.current.rightSidebarCollapsed).toBe(false);
    act(() => result.current.actions.sharedActions.onQuickLook?.(nextFile));
    expect(result.current.selectedFile).toBe(nextFile);
    expect(result.current.selectedFiles).toEqual(new Set([nextFile.path]));
    expect(result.current.rightPanelTab).toBe('preview');
    expect(result.current.rightSidebarCollapsed).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(TauriAPI.openFile).not.toHaveBeenCalled();
    expect(TauriAPI.addRecentFile).not.toHaveBeenCalled();
  });

  it('returns toolbar focus only to the active pane file row, including paths containing quotes', async () => {
    const quotedFile = {
      ...file,
      name: 'report "draft".txt',
      path: '/Projects/report "draft".txt',
    };
    render(
      <>
        <button type="button">Preview file</button>
        <div data-group-id="other" data-active="false">
          <div tabIndex={0} data-file-path={quotedFile.path} data-testid="inactive-file">
            {quotedFile.name}
          </div>
        </div>
        <div data-group-id="main" data-active="true">
          <div tabIndex={0} data-file-path={quotedFile.path} data-testid="active-file">
            {quotedFile.name}
          </div>
        </div>
      </>,
    );
    const activeRow = screen.getByTestId('active-file');
    const inactiveRow = screen.getByTestId('inactive-file');
    const focusActive = vi.spyOn(activeRow, 'focus');
    const focusInactive = vi.spyOn(inactiveRow, 'focus');
    screen.getByRole('button', { name: 'Preview file' }).focus();
    const { result } = renderHook(() => useWispActions(dependencies('/Projects', [quotedFile])));

    act(() => result.current.handlePreviewFile(quotedFile));

    await waitFor(() => expect(activeRow).toHaveFocus());
    expect(focusActive).toHaveBeenCalledWith({ preventScroll: true });
    expect(focusInactive).not.toHaveBeenCalled();
    focusActive.mockRestore();
    focusInactive.mockRestore();
  });

  it('cancels a pending reveal so its late directory result cannot replace the preview', async () => {
    const deps = dependencies('/Projects');
    const previewFile = { ...file, name: 'preview.txt', path: '/Elsewhere/preview.txt' };
    const { result, rerender } = renderHook((props) => useWispActions(props), {
      initialProps: deps,
    });
    await act(async () =>
      result.current.handleCommandPaletteFileSelect(file.path, false, 'reveal'),
    );
    expect(navigate).toHaveBeenCalledWith('/');
    expect(deps.pendingSelectRef.current).toBe(file.path);

    act(() => result.current.sharedActions.onQuickLook?.(previewFile));
    expect(deps.pendingSelectRef.current).toBeNull();
    rerender({ ...deps, currentPath: '/' });
    act(() => result.current.sharedActions.onDirectoryReady?.('/', [file], true));
    expect(deps.setSelectedFile).toHaveBeenCalledTimes(1);
    expect(deps.setSelectedFile).toHaveBeenLastCalledWith(previewFile);
    expect(deps.setSelectedFiles).toHaveBeenLastCalledWith(new Set([previewFile.path]));
    expect(deps.setRightPanelTab).toHaveBeenLastCalledWith('preview');
    expect(deps.setRightSidebarCollapsed).toHaveBeenLastCalledWith(false);
  });

  it('invalidates a reveal still resolving its home path when a preview is requested', async () => {
    let finish!: (value: Awaited<ReturnType<typeof TauriAPI.getUserDirectories>>) => void;
    vi.mocked(TauriAPI.getUserDirectories).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const deps = dependencies('/Projects');
    const { result } = renderHook(() => useWispActions(deps));
    const request = result.current.handleCommandPaletteFileSelect('~/notes.txt', false, 'reveal');
    act(() => result.current.handlePreviewFile(file));

    await act(async () => {
      finish({ home: '/Users/test' } as Awaited<ReturnType<typeof TauriAPI.getUserDirectories>>);
      await request;
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(deps.pendingSelectRef.current).toBeNull();
    expect(deps.setSelectedFile).toHaveBeenCalledTimes(1);
    expect(deps.setSelectedFile).toHaveBeenCalledWith(file);
    expect(deps.setSelectedFiles).toHaveBeenCalledWith(new Set([file.path]));
    expect(deps.setRightSidebarCollapsed).toHaveBeenCalledWith(false);
  });
});

describe('search entry action integration', () => {
  it('opens files by default instead of navigating to their parent', async () => {
    const { result } = renderHook(() => useWispActions(dependencies('/Projects')));
    await act(async () => result.current.handleCommandPaletteFileSelect(file.path, false));
    expect(TauriAPI.openFile).toHaveBeenCalledWith(file.path);
    expect(TauriAPI.addRecentFile).toHaveBeenCalledWith(file.path);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reveals at the filesystem root and defers selection until that directory loads', async () => {
    const deps = dependencies('/Projects');
    const { result } = renderHook(() => useWispActions(deps));
    await act(async () =>
      result.current.handleCommandPaletteFileSelect(file.path, false, 'reveal'),
    );
    expect(navigate).toHaveBeenCalledWith('/');
    expect(deps.pendingSelectRef.current).toBe('/notes.txt');
    expect(TauriAPI.openFile).not.toHaveBeenCalled();
    expect(TauriAPI.addRecentFile).not.toHaveBeenCalled();
  });

  it('selects a revealed entry immediately when its parent is already open', async () => {
    const deps = dependencies('/', [file]);
    const { result } = renderHook(() => useWispActions(deps));
    await act(async () =>
      result.current.handleCommandPaletteFileSelect(file.path, false, 'reveal'),
    );
    expect(deps.setSelectedFile).toHaveBeenCalledWith(file);
    expect(deps.setSelectedFiles).toHaveBeenCalledWith(new Set(['/notes.txt']));
    expect(deps.pendingSelectRef.current).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(TauriAPI.addRecentFile).not.toHaveBeenCalled();
  });

  it('keeps a reveal pending while the same directory refreshes its data', async () => {
    const deps = dependencies('/');
    const { result } = renderHook(() => useWispActions(deps));
    await act(async () =>
      result.current.handleCommandPaletteFileSelect(file.path, false, 'reveal'),
    );
    expect(deps.refetch).toHaveBeenCalledTimes(1);
    expect(deps.pendingSelectRef.current).toBe(file.path);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ignores old directory batches and selects only when the target directory settles', async () => {
    const deps = dependencies('/Projects');
    const { result, rerender } = renderHook((props) => useWispActions(props), {
      initialProps: deps,
    });
    await act(async () =>
      result.current.handleCommandPaletteFileSelect(file.path, false, 'reveal'),
    );
    act(() => result.current.sharedActions.onDirectoryReady?.('/Projects', [], true));
    expect(deps.pendingSelectRef.current).toBe(file.path);
    rerender({ ...deps, currentPath: '/' });
    act(() => result.current.sharedActions.onDirectoryReady?.('/Projects', [file], true));
    expect(deps.pendingSelectRef.current).toBe(file.path);
    expect(deps.setSelectedFile).not.toHaveBeenCalled();
    act(() => result.current.sharedActions.onDirectoryReady?.('/', [file], true));
    expect(deps.setSelectedFile).toHaveBeenCalledWith(file);
    expect(deps.pendingSelectRef.current).toBeNull();
  });

  it.each([true, false])(
    'clears an absent target after its directory settles (success=%s)',
    async (succeeded) => {
      const deps = dependencies('/');
      const { result } = renderHook(() => useWispActions(deps));
      await act(async () =>
        result.current.handleCommandPaletteFileSelect(file.path, false, 'reveal'),
      );
      act(() => result.current.sharedActions.onDirectoryReady?.('/', [], succeeded));
      expect(deps.pendingSelectRef.current).toBeNull();
      act(() => result.current.sharedActions.onDirectoryReady?.('/', [file], true));
      expect(deps.setSelectedFile).not.toHaveBeenCalled();
    },
  );

  it('abandons a target when the user leaves its directory before it finishes loading', async () => {
    const deps = dependencies('/Projects');
    const { result, rerender } = renderHook((props) => useWispActions(props), {
      initialProps: deps,
    });
    await act(async () =>
      result.current.handleCommandPaletteFileSelect(file.path, false, 'reveal'),
    );
    rerender({ ...deps, currentPath: '/' });
    expect(deps.pendingSelectRef.current).toBe(file.path);
    rerender({ ...deps, currentPath: '/Elsewhere' });
    expect(deps.pendingSelectRef.current).toBeNull();
    rerender({ ...deps, currentPath: '/' });
    act(() => result.current.sharedActions.onDirectoryReady?.('/', [file], true));
    expect(deps.setSelectedFile).not.toHaveBeenCalled();
  });

  it('does not navigate after a delayed tilde lookup when the user has left', async () => {
    let finish!: (value: Awaited<ReturnType<typeof TauriAPI.getUserDirectories>>) => void;
    vi.mocked(TauriAPI.getUserDirectories).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const deps = dependencies('/Projects');
    const { result, rerender } = renderHook((props) => useWispActions(props), {
      initialProps: deps,
    });
    const request = result.current.handleCommandPaletteFileSelect('~/notes.txt', false, 'reveal');
    rerender({ ...deps, currentPath: '/Elsewhere' });
    await act(async () => {
      finish({ home: '/Users/test' } as Awaited<ReturnType<typeof TauriAPI.getUserDirectories>>);
      await request;
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(deps.pendingSelectRef.current).toBeNull();
  });
});
