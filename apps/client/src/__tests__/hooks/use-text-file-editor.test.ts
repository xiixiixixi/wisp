import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { useTextFileEditor } from '@/hooks/use-text-file-editor';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';

vi.mock('@/lib/tauri-api', () => ({ TauriAPI: { readTextFile: vi.fn(), saveTextFile: vi.fn() } }));
const file = { name: 'original.md', path: '/original.md', size: 0, is_dir: false } as FileEntry;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(TauriAPI.readTextFile).mockResolvedValue('');
  vi.mocked(TauriAPI.saveTextFile).mockResolvedValue(undefined);
});

describe('text editor save identity', () => {
  it('saves to the loaded file, not a declined file selection, including initially empty files', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const ref = {
      current: { state: { doc: { toString: () => 'unsaved draft' } } } as unknown as EditorView,
    };
    const { result, rerender } = renderHook(({ entry }) => useTextFileEditor(entry, ref), {
      initialProps: { entry: file },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setDirty(true));
    rerender({ entry: { ...file, name: 'other.md', path: '/other.md' } });
    expect(confirm).toHaveBeenCalledOnce();
    await act(async () => result.current.save());
    expect(TauriAPI.saveTextFile).toHaveBeenCalledWith('/original.md', 'unsaved draft');
    expect(TauriAPI.readTextFile).not.toHaveBeenCalledWith('/other.md');
    confirm.mockRestore();
  });

  it('coalesces repeated save gestures while a write is pending', async () => {
    let finish!: () => void;
    vi.mocked(TauriAPI.saveTextFile).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const ref = {
      current: { state: { doc: { toString: () => 'draft' } } } as unknown as EditorView,
    };
    const { result } = renderHook(() => useTextFileEditor(file, ref));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let first!: Promise<void>;
    act(() => {
      first = result.current.save();
      void result.current.save();
    });
    expect(TauriAPI.saveTextFile).toHaveBeenCalledOnce();
    await act(async () => {
      finish();
      await first;
    });
  });
});
