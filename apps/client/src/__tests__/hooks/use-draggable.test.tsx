import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

const mockStartDrag = vi.fn().mockResolvedValue(undefined);
const mockStartInternalDrag = vi.fn();
const mockEndInternalDrag = vi.fn();

vi.mock('@crabnebula/tauri-plugin-drag', () => ({
  startDrag: (...args: unknown[]) => mockStartDrag(...args),
}));
vi.mock('@tauri-apps/api/path', () => ({
  resolveResource: vi.fn().mockResolvedValue('/icons/icon.png'),
}));
vi.mock('@/lib/transport', () => ({
  isTauri: () => true,
}));
vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: { getFileIconPng: vi.fn().mockResolvedValue('/tmp/file-icon.png') },
}));
vi.mock('@/contexts/DragDropContext', () => ({
  useDragDropContext: () => ({
    startInternalDrag: mockStartInternalDrag,
    endInternalDrag: mockEndInternalDrag,
  }),
}));

import { useDraggable } from '@/hooks/use-draggable';
import type { FileEntry } from '@/lib/tauri-api';

const file: FileEntry = {
  name: 'note.txt',
  path: '/Users/test/note.txt',
  size: 10,
  is_dir: false,
  modified: 0,
  file_type: 'text',
  is_readonly: false,
};

const Probe = () => {
  const handlers = useDraggable({ file, selectedFiles: new Set(), allFiles: [file] });
  return (
    <div
      data-testid="probe"
      {...handlers}
      onMouseDown={(e) => {
        handlers.onMouseDown(e);
      }}
    />
  );
};

const startDragOnProbe = async (metaKey: boolean) => {
  const { getByTestId } = render(<Probe />);
  const el = getByTestId('probe');
  fireEvent.mouseDown(el, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.mouseMove(el, { clientX: 120, clientY: 112, metaKey });
  await waitFor(() => expect(mockStartDrag).toHaveBeenCalled());
};

describe('useDraggable', () => {
  beforeEach(() => {
    mockStartDrag.mockClear();
    mockStartInternalDrag.mockClear();
    mockEndInternalDrag.mockClear();
  });

  it('starts a file drag without modifiers', async () => {
    await startDragOnProbe(false);

    expect(mockStartDrag).toHaveBeenCalledWith(
      expect.objectContaining({ item: ['/Users/test/note.txt'] }),
      expect.any(Function),
    );
    expect(mockStartInternalDrag).toHaveBeenCalledWith(['/Users/test/note.txt'], 'move');
  });

  it('starts a copy drag when ⌥ is already held', async () => {
    const { getByTestId } = render(<Probe />);
    const el = getByTestId('probe');
    fireEvent.mouseDown(el, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(el, { clientX: 120, clientY: 112, altKey: true });
    await waitFor(() => expect(mockStartDrag).toHaveBeenCalled());

    expect(mockStartInternalDrag).toHaveBeenCalledWith(['/Users/test/note.txt'], 'copy');
  });

  it('starts a link drag when ⌘⌥ are held (not a text drag)', async () => {
    const { getByTestId } = render(<Probe />);
    const el = getByTestId('probe');
    fireEvent.mouseDown(el, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(el, { clientX: 120, clientY: 112, metaKey: true, altKey: true });
    await waitFor(() => expect(mockStartDrag).toHaveBeenCalled());

    expect(mockStartDrag).toHaveBeenCalledWith(
      expect.objectContaining({ item: ['/Users/test/note.txt'] }),
      expect.any(Function),
    );
    expect(mockStartInternalDrag).toHaveBeenCalledWith(['/Users/test/note.txt'], 'link');
  });

  it('starts a plain-text drag with ⌘ held (terminal path paste)', async () => {
    await startDragOnProbe(true);

    expect(mockStartDrag).toHaveBeenCalledWith(
      expect.objectContaining({
        item: { data: '/Users/test/note.txt', types: ['public.utf8-plain-text'] },
      }),
      expect.any(Function),
    );
    expect(mockStartInternalDrag).not.toHaveBeenCalled();
  });

  it('ends the internal drag when the native drag finishes', async () => {
    await startDragOnProbe(false);

    const onEvent = mockStartDrag.mock.calls[0][1] as () => void;
    onEvent();

    expect(mockEndInternalDrag).toHaveBeenCalled();
  });

  it('ends the internal drag if startDrag rejects', async () => {
    mockStartDrag.mockRejectedValueOnce(new Error('no tauri'));
    await startDragOnProbe(false);

    await waitFor(() => expect(mockEndInternalDrag).toHaveBeenCalled());
  });

  it('does not start a drag below the movement threshold', async () => {
    const { getByTestId } = render(<Probe />);
    const el = getByTestId('probe');
    fireEvent.mouseDown(el, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(el, { clientX: 102, clientY: 101 });

    expect(mockStartDrag).not.toHaveBeenCalled();
  });
});

describe('useDraggable in web mode', () => {
  beforeEach(() => {
    mockStartDrag.mockClear();
    mockStartInternalDrag.mockClear();
    mockEndInternalDrag.mockClear();
  });

  it('skips drags entirely and surfaces a hint so the overlay can never get stuck', async () => {
    vi.doMock('@/lib/transport', () => ({ isTauri: () => false }));
    vi.resetModules();
    const { useDraggable: webUseDraggable } = await import('@/hooks/use-draggable');

    const attemptListener = vi.fn();
    window.addEventListener('web-drag-attempt', attemptListener);

    const WebProbe = () => {
      const handlers = webUseDraggable({
        file,
        selectedFiles: new Set(),
        allFiles: [file],
      });
      return <div data-testid="web-probe" {...handlers} />;
    };
    const { getByTestId } = render(<WebProbe />);
    const el = getByTestId('web-probe');
    fireEvent.mouseDown(el, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(el, { clientX: 130, clientY: 130 });

    expect(mockStartDrag).not.toHaveBeenCalled();
    expect(mockStartInternalDrag).not.toHaveBeenCalled();
    expect(attemptListener).toHaveBeenCalled();

    window.removeEventListener('web-drag-attempt', attemptListener);
  });
});
