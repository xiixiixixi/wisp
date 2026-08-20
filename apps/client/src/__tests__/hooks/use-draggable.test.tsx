import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

const mockStartDrag = vi.fn().mockResolvedValue(undefined);
const mockStartInternalDrag = vi.fn();

vi.mock('@crabnebula/tauri-plugin-drag', () => ({
  startDrag: (...args: unknown[]) => mockStartDrag(...args),
}));
vi.mock('@tauri-apps/api/path', () => ({
  resolveResource: vi.fn().mockResolvedValue('/icons/icon.png'),
}));
vi.mock('@/contexts/DragDropContext', () => ({
  useDragDropContext: () => ({ startInternalDrag: mockStartInternalDrag }),
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
  });

  it('starts a file drag without modifiers', async () => {
    await startDragOnProbe(false);

    expect(mockStartDrag).toHaveBeenCalledWith(
      expect.objectContaining({ item: ['/Users/test/note.txt'] }),
    );
    expect(mockStartInternalDrag).toHaveBeenCalledWith(['/Users/test/note.txt']);
  });

  it('starts a plain-text drag with ⌘ held (terminal path paste)', async () => {
    await startDragOnProbe(true);

    expect(mockStartDrag).toHaveBeenCalledWith(
      expect.objectContaining({
        item: { data: '/Users/test/note.txt', types: ['public.utf8-plain-text'] },
      }),
    );
    expect(mockStartInternalDrag).not.toHaveBeenCalled();
  });

  it('does not start a drag below the movement threshold', async () => {
    const { getByTestId } = render(<Probe />);
    const el = getByTestId('probe');
    fireEvent.mouseDown(el, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.mouseMove(el, { clientX: 102, clientY: 101 });

    expect(mockStartDrag).not.toHaveBeenCalled();
  });
});
