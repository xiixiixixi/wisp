import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { undo, undoDepth } from '@codemirror/commands';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CodeMirrorPreview from '@/components/previews/CodeMirrorPreview';
import { FILE_CONTENT_CHANGED_EVENT } from '@/lib/file-change-events';
import { TauriAPI, type FileEntry } from '@/lib/tauri-api';

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: { readTextFile: vi.fn(), saveTextFile: vi.fn() },
}));

const file: FileEntry = {
  name: 'notes.txt',
  path: '/notes.txt',
  size: 11,
  modified: 1,
  is_dir: false,
  file_type: 'text',
};

async function editorFrom(container: HTMLElement) {
  let view: EditorView | null = null;
  await waitFor(() => {
    const element = container.querySelector<HTMLElement>('.cm-editor');
    expect(element).not.toBeNull();
    view = EditorView.findFromDOM(element!);
    expect(view).not.toBeNull();
  });
  return view!;
}

async function changeOnDisk(eventName = FILE_CONTENT_CHANGED_EVENT) {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(eventName, { detail: { path: file.path } }));
  });
}

beforeEach(() => {
  vi.mocked(TauriAPI.readTextFile).mockReset();
  vi.mocked(TauriAPI.saveTextFile).mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CodeMirrorPreview external refresh with the real editor', () => {
  it.each([false, true])(
    'keeps consecutive disk updates clean when initialEditable is %s',
    async (initialEditable) => {
      let diskContent = 'VERSION ONE';
      vi.mocked(TauriAPI.readTextFile).mockImplementation(async () => diskContent);
      const { container } = render(
        <CodeMirrorPreview file={file} initialEditable={initialEditable} />,
      );
      const view = await editorFrom(container);
      expect(view.state.doc.toString()).toBe('VERSION ONE');

      diskContent = 'VERSION TWO';
      await changeOnDisk();
      await waitFor(() => expect(view.state.doc.toString()).toBe('VERSION TWO'));
      expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();
      diskContent = 'VERSION THREE';
      await changeOnDisk('wisp-file-written');
      await waitFor(() => expect(view.state.doc.toString()).toBe('VERSION THREE'));
      expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();
      expect(TauriAPI.readTextFile).toHaveBeenCalledTimes(3);
      expect(EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)).toBe(
        view,
      );
      expect(undoDepth(view.state)).toBe(0);
      act(() => expect(undo(view)).toBe(false));
      if (initialEditable) {
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      } else {
        expect(container.querySelector('[data-preview-readonly]')).toHaveAttribute(
          'data-preview-readonly',
          'true',
        );
        expect(container.querySelector('[data-preview-editing]')).toBeNull();
      }
    },
  );

  it('protects a real user draft from subsequent disk-change events', async () => {
    let diskContent = 'VERSION ONE';
    vi.mocked(TauriAPI.readTextFile).mockImplementation(async () => diskContent);
    const { container } = render(<CodeMirrorPreview file={file} initialEditable />);
    const view = await editorFrom(container);
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: ' draft' } }));
    expect(screen.getByText(/unsaved/i)).toBeInTheDocument();

    diskContent = 'VERSION TWO';
    await changeOnDisk();
    diskContent = 'VERSION THREE';
    await changeOnDisk('wisp-file-written');
    expect(view.state.doc.toString()).toBe('VERSION ONE draft');
    expect(TauriAPI.readTextFile).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('does not replay previously saved edits after the disk baseline changes', async () => {
    let diskContent = 'VERSION ONE';
    vi.mocked(TauriAPI.readTextFile).mockImplementation(async () => diskContent);
    const { container } = render(<CodeMirrorPreview file={file} initialEditable />);
    const view = await editorFrom(container);
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: ' saved' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument());
    expect(TauriAPI.saveTextFile).toHaveBeenCalledWith(file.path, 'VERSION ONE saved');
    expect(undoDepth(view.state)).toBe(1);

    diskContent = 'VERSION TWO';
    await changeOnDisk();
    await waitFor(() => expect(view.state.doc.toString()).toBe('VERSION TWO'));
    act(() => expect(undo(view)).toBe(false));
    expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();
    diskContent = 'VERSION THREE';
    await changeOnDisk();
    await waitFor(() => expect(view.state.doc.toString()).toBe('VERSION THREE'));
    expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument();

    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: ' draft' } }));
    act(() => expect(undo(view)).toBe(true));
    expect(view.state.doc.toString()).toBe('VERSION THREE');
    expect(screen.getByText(/unsaved/i)).toBeInTheDocument();
  });
});
