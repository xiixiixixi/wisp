import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    pendingSelectRef: { current: null },
    refetch: vi.fn(),
    toast: vi.fn(),
    fileOps: { renameFileInline: vi.fn(), contextMenuActions: {} },
    ctxMenu: {},
    dialogManager: {},
    crossTabSelection: {},
    paneRefetchRef: { current: vi.fn() },
    handleQuickLook: vi.fn(),
  }) as unknown as WispActionsDeps;

beforeEach(() => vi.clearAllMocks());

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
