import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { useTextFileEditor } from '@/hooks/use-text-file-editor';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';
import { FILE_CONTENT_CHANGED_EVENT } from '@/lib/file-change-events';

vi.mock('@/lib/tauri-api', () => ({ TauriAPI: { readTextFile: vi.fn(), saveTextFile: vi.fn() } }));
const file = { name: 'original.md', path: '/original.md', size: 0, is_dir: false } as FileEntry;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(TauriAPI.readTextFile).mockReset().mockResolvedValue('');
  vi.mocked(TauriAPI.saveTextFile).mockReset().mockResolvedValue(undefined);
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const mockEditor = (initial = 'initial') => {
  let document = initial;
  const ref = {
    current: { state: { doc: { toString: () => document } } } as unknown as EditorView,
  };
  return {
    ref,
    edit: (text: string) => {
      document = text;
    },
  };
};

const changed = (eventName: string, path = file.path) =>
  window.dispatchEvent(new CustomEvent(eventName, { detail: { path } }));

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

  it('keeps newer edits when a save finishes', async () => {
    const write = deferred<void>();
    vi.mocked(TauriAPI.readTextFile).mockResolvedValue('initial');
    vi.mocked(TauriAPI.saveTextFile).mockReturnValue(write.promise);
    const { ref, edit } = mockEditor();
    const { result } = renderHook(() => useTextFileEditor(file, ref));
    await waitFor(() => expect(result.current.content).toBe('initial'));
    act(() => {
      edit('saved draft');
      result.current.setDirty(true);
    });
    let save!: Promise<void>;
    act(() => {
      save = result.current.save();
      edit('newer draft');
      result.current.setDirty(true);
    });

    await act(async () => {
      write.resolve();
      await save;
    });

    expect(TauriAPI.saveTextFile).toHaveBeenCalledWith(file.path, 'saved draft');
    expect(result.current.dirty).toBe(true);
    expect(ref.current.state.doc.toString()).toBe('newer draft');
  });

  it('does not replace another file when an old save finishes', async () => {
    const write = deferred<void>();
    vi.mocked(TauriAPI.readTextFile)
      .mockResolvedValueOnce('initial')
      .mockResolvedValueOnce('other file');
    vi.mocked(TauriAPI.saveTextFile).mockReturnValue(write.promise);
    const { ref } = mockEditor();
    const { result, rerender } = renderHook(({ entry }) => useTextFileEditor(entry, ref), {
      initialProps: { entry: file },
    });
    await waitFor(() => expect(result.current.content).toBe('initial'));
    let save!: Promise<void>;
    act(() => {
      save = result.current.save();
    });
    rerender({ entry: { ...file, path: '/other.md', name: 'other.md' } });
    await waitFor(() => expect(result.current.content).toBe('other file'));

    await act(async () => {
      write.resolve();
      await save;
    });

    expect(result.current.content).toBe('other file');
    expect(TauriAPI.saveTextFile).toHaveBeenCalledWith(file.path, 'initial');
  });
});

describe('text editor automatic refresh', () => {
  it.each([
    { modified: 2, size: 7 },
    { modified: 1, size: 12 },
  ])('reloads same-path metadata changes: %j', async (version) => {
    vi.mocked(TauriAPI.readTextFile)
      .mockResolvedValueOnce('initial')
      .mockResolvedValueOnce('updated');
    const { ref } = mockEditor();
    const { result, rerender } = renderHook(({ entry }) => useTextFileEditor(entry, ref), {
      initialProps: { entry: { ...file, modified: 1, size: 7 } },
    });
    await waitFor(() => expect(result.current.content).toBe('initial'));

    rerender({ entry: { ...file, ...version } });

    await waitFor(() => expect(result.current.content).toBe('updated'));
    expect(TauriAPI.readTextFile).toHaveBeenCalledTimes(2);
    expect(result.current.dirty).toBe(false);
  });

  it.each(['wisp-file-written', FILE_CONTENT_CHANGED_EVENT])(
    'reloads matching %s events even when metadata is unchanged',
    async (eventName) => {
      vi.mocked(TauriAPI.readTextFile)
        .mockResolvedValueOnce('initial')
        .mockResolvedValueOnce('updated');
      const { ref } = mockEditor();
      const { result } = renderHook(() => useTextFileEditor(file, ref));
      await waitFor(() => expect(result.current.content).toBe('initial'));

      act(() => {
        changed(eventName);
      });

      await waitFor(() => expect(result.current.content).toBe('updated'));
      expect(TauriAPI.readTextFile).toHaveBeenCalledTimes(2);
    },
  );

  it('ignores content events for another file', async () => {
    vi.mocked(TauriAPI.readTextFile).mockResolvedValue('initial');
    const { ref } = mockEditor();
    const { result } = renderHook(() => useTextFileEditor(file, ref));
    await waitFor(() => expect(result.current.content).toBe('initial'));

    act(() => {
      changed(FILE_CONTENT_CHANGED_EVENT, '/another.md');
    });

    expect(TauriAPI.readTextFile).toHaveBeenCalledOnce();
  });

  it('protects unsaved edits from metadata updates and content events', async () => {
    vi.mocked(TauriAPI.readTextFile).mockResolvedValue('initial');
    const { ref, edit } = mockEditor();
    const { result, rerender } = renderHook(({ entry }) => useTextFileEditor(entry, ref), {
      initialProps: { entry: file },
    });
    await waitFor(() => expect(result.current.content).toBe('initial'));
    act(() => {
      edit('unsaved draft');
      result.current.setDirty(true);
    });

    rerender({ entry: { ...file, modified: 2, size: 12 } });
    act(() => {
      changed(FILE_CONTENT_CHANGED_EVENT);
      changed('wisp-file-written');
    });

    expect(TauriAPI.readTextFile).toHaveBeenCalledOnce();
    expect(result.current.content).toBe('initial');
    expect(result.current.dirty).toBe(true);
    expect(ref.current.state.doc.toString()).toBe('unsaved draft');
  });

  it('does not reload while saving', async () => {
    const write = deferred<void>();
    vi.mocked(TauriAPI.readTextFile).mockResolvedValue('initial');
    vi.mocked(TauriAPI.saveTextFile).mockReturnValue(write.promise);
    const { ref } = mockEditor();
    const { result } = renderHook(() => useTextFileEditor(file, ref));
    await waitFor(() => expect(result.current.content).toBe('initial'));
    let save!: Promise<void>;
    act(() => {
      save = result.current.save();
      changed(FILE_CONTENT_CHANGED_EVENT);
      changed('wisp-file-written');
    });

    expect(result.current.saving).toBe(true);
    expect(TauriAPI.readTextFile).toHaveBeenCalledOnce();
    await act(async () => {
      write.resolve();
      await save;
    });
  });

  it('rejects a reload result when the user edits during the read', async () => {
    const read = deferred<string>();
    vi.mocked(TauriAPI.readTextFile)
      .mockResolvedValueOnce('initial')
      .mockReturnValueOnce(read.promise);
    const { ref, edit } = mockEditor();
    const { result } = renderHook(() => useTextFileEditor(file, ref));
    await waitFor(() => expect(result.current.content).toBe('initial'));
    act(() => {
      changed(FILE_CONTENT_CHANGED_EVENT);
    });
    act(() => {
      edit('new draft');
      result.current.setDirty(true);
    });

    await act(async () => {
      read.resolve('disk content');
    });

    expect(result.current.content).toBe('initial');
    expect(result.current.dirty).toBe(true);
    expect(ref.current.state.doc.toString()).toBe('new draft');
  });

  it('rejects a reload result when the editor changes without a rendered dirty update', async () => {
    const read = deferred<string>();
    vi.mocked(TauriAPI.readTextFile)
      .mockResolvedValueOnce('initial')
      .mockReturnValueOnce(read.promise);
    const { ref, edit } = mockEditor();
    const { result } = renderHook(() => useTextFileEditor(file, ref));
    await waitFor(() => expect(result.current.content).toBe('initial'));
    act(() => {
      changed(FILE_CONTENT_CHANGED_EVENT);
    });
    edit('new draft');

    await act(async () => {
      read.resolve('disk content');
    });

    expect(result.current.content).toBe('initial');
    expect(ref.current.state.doc.toString()).toBe('new draft');
  });

  it('does not apply an earlier read after a save completes', async () => {
    const read = deferred<string>();
    vi.mocked(TauriAPI.readTextFile)
      .mockResolvedValueOnce('initial')
      .mockReturnValueOnce(read.promise);
    const { ref } = mockEditor();
    const { result } = renderHook(() => useTextFileEditor(file, ref));
    await waitFor(() => expect(result.current.content).toBe('initial'));
    act(() => {
      changed(FILE_CONTENT_CHANGED_EVENT);
    });
    await act(async () => {
      await result.current.save();
    });

    await act(async () => {
      read.resolve('older disk content');
    });

    expect(result.current.content).toBe('initial');
    expect(TauriAPI.saveTextFile).toHaveBeenCalledWith(file.path, 'initial');
  });

  it('keeps only the latest requested reload result', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    vi.mocked(TauriAPI.readTextFile)
      .mockResolvedValueOnce('initial')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { ref } = mockEditor();
    const { result } = renderHook(() => useTextFileEditor(file, ref));
    await waitFor(() => expect(result.current.content).toBe('initial'));
    act(() => {
      changed(FILE_CONTENT_CHANGED_EVENT);
      changed('wisp-file-written');
    });

    await act(async () => {
      second.resolve('newest');
    });
    await act(async () => {
      first.resolve('older');
    });

    expect(result.current.content).toBe('newest');
  });

  it('does not replace a new file with the previous file reload result', async () => {
    const read = deferred<string>();
    vi.mocked(TauriAPI.readTextFile)
      .mockResolvedValueOnce('initial')
      .mockReturnValueOnce(read.promise)
      .mockResolvedValueOnce('other file');
    const { ref } = mockEditor();
    const { result, rerender } = renderHook(({ entry }) => useTextFileEditor(entry, ref), {
      initialProps: { entry: file },
    });
    await waitFor(() => expect(result.current.content).toBe('initial'));
    act(() => {
      changed(FILE_CONTENT_CHANGED_EVENT);
    });
    rerender({ entry: { ...file, path: '/other.md', name: 'other.md' } });
    await waitFor(() => expect(result.current.content).toBe('other file'));

    await act(async () => {
      read.resolve('stale original');
    });

    expect(result.current.content).toBe('other file');
  });

  it('rereads a content change received during the first load', async () => {
    const first = deferred<string>();
    vi.mocked(TauriAPI.readTextFile)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce('latest content');
    const { ref } = mockEditor();
    const { result } = renderHook(() => useTextFileEditor(file, ref));
    act(() => {
      changed(FILE_CONTENT_CHANGED_EVENT);
    });

    await act(async () => {
      first.resolve('initial');
    });

    await waitFor(() => expect(result.current.content).toBe('latest content'));
    expect(TauriAPI.readTextFile).toHaveBeenCalledTimes(2);
  });

  it('rereads metadata that changes during the first load', async () => {
    const first = deferred<string>();
    vi.mocked(TauriAPI.readTextFile)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce('latest content');
    const { ref } = mockEditor();
    const { result, rerender } = renderHook(({ entry }) => useTextFileEditor(entry, ref), {
      initialProps: { entry: file },
    });
    rerender({ entry: { ...file, modified: 2 } });

    await act(async () => {
      first.resolve('initial');
    });

    await waitFor(() => expect(result.current.content).toBe('latest content'));
    expect(TauriAPI.readTextFile).toHaveBeenCalledTimes(2);
  });

  it.each(['content event', 'metadata update'])(
    'recovers a failed initial load after a %s',
    async (trigger) => {
      vi.mocked(TauriAPI.readTextFile)
        .mockRejectedValueOnce(new Error('temporarily unavailable'))
        .mockResolvedValueOnce('restored content');
      const { ref } = mockEditor();
      const onLoad = vi.fn();
      const { result, rerender } = renderHook(
        ({ entry }) => useTextFileEditor(entry, ref, { onLoad }),
        {
          initialProps: { entry: file },
        },
      );
      await waitFor(() => expect(result.current.error).toBe('temporarily unavailable'));
      if (trigger === 'content event') {
        act(() => {
          changed(FILE_CONTENT_CHANGED_EVENT);
        });
      } else {
        rerender({ entry: { ...file, modified: 2 } });
      }

      await waitFor(() => expect(result.current.content).toBe('restored content'));
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(onLoad).toHaveBeenCalledOnce();
      expect(TauriAPI.readTextFile).toHaveBeenCalledTimes(2);
    },
  );

  it('does not apply the first load after changing files', async () => {
    const first = deferred<string>();
    vi.mocked(TauriAPI.readTextFile)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce('other file');
    const { ref } = mockEditor();
    const { result, rerender } = renderHook(({ entry }) => useTextFileEditor(entry, ref), {
      initialProps: { entry: file },
    });
    rerender({ entry: { ...file, path: '/other.md', name: 'other.md' } });
    await waitFor(() => expect(result.current.content).toBe('other file'));

    await act(async () => {
      first.resolve('stale original');
    });

    expect(result.current.content).toBe('other file');
  });

  it('does not report an initial load completed after unmount', async () => {
    const first = deferred<string>();
    vi.mocked(TauriAPI.readTextFile).mockReturnValue(first.promise);
    const { ref } = mockEditor();
    const onLoad = vi.fn();
    const onError = vi.fn();
    const { unmount } = renderHook(() => useTextFileEditor(file, ref, { onLoad, onError }));
    unmount();

    await act(async () => {
      first.resolve('late content');
    });

    expect(onLoad).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('preserves readable content when an automatic reread fails', async () => {
    vi.mocked(TauriAPI.readTextFile)
      .mockResolvedValueOnce('initial')
      .mockRejectedValueOnce(new Error('temporarily unavailable'));
    const { ref } = mockEditor();
    const { result } = renderHook(() => useTextFileEditor(file, ref));
    await waitFor(() => expect(result.current.content).toBe('initial'));

    await act(async () => {
      changed(FILE_CONTENT_CHANGED_EVENT);
    });

    expect(result.current.content).toBe('initial');
    expect(result.current.error).toBeNull();
    expect(result.current.dirty).toBe(false);
  });

  it('removes content listeners on unmount and discards a pending reread', async () => {
    const read = deferred<string>();
    vi.mocked(TauriAPI.readTextFile)
      .mockResolvedValueOnce('initial')
      .mockReturnValueOnce(read.promise);
    const { ref } = mockEditor();
    const { result, unmount } = renderHook(() => useTextFileEditor(file, ref));
    await waitFor(() => expect(result.current.content).toBe('initial'));
    act(() => {
      changed(FILE_CONTENT_CHANGED_EVENT);
    });
    unmount();

    await act(async () => {
      read.resolve('late content');
      changed(FILE_CONTENT_CHANGED_EVENT);
      changed('wisp-file-written');
    });

    expect(TauriAPI.readTextFile).toHaveBeenCalledTimes(2);
    expect(result.current.content).toBe('initial');
  });
});
