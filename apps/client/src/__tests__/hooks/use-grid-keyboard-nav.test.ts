import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useGridKeyboardNav } from '@/hooks/use-grid-keyboard-nav';
import type { FileEntry } from '@/lib/tauri-api';
import { requestAdjacentFile } from '@/lib/file-navigation';

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {},
}));

describe('useGridKeyboardNav', () => {
  const mockHandleFileClick = vi.fn();
  const mockHandleFileDoubleClick = vi.fn();
  const mockScrollToIndex = vi.fn();
  const mockOnQuickLook = vi.fn();

  const sampleFiles: FileEntry[] = [
    { name: 'a.txt', path: '/a.txt', size: 100, is_dir: false, modified: 0, file_type: 'text' },
    { name: 'b.txt', path: '/b.txt', size: 200, is_dir: false, modified: 0, file_type: 'text' },
    { name: 'c.txt', path: '/c.txt', size: 300, is_dir: false, modified: 0, file_type: 'text' },
    { name: 'd.txt', path: '/d.txt', size: 400, is_dir: false, modified: 0, file_type: 'text' },
    { name: 'e.txt', path: '/e.txt', size: 500, is_dir: false, modified: 0, file_type: 'text' },
    { name: 'f.txt', path: '/f.txt', size: 600, is_dir: false, modified: 0, file_type: 'text' },
  ];

  const defaultOptions = {
    files: sampleFiles,
    selectedFiles: new Set<string>(),
    columns: 3,
    viewMode: 'grid',
    getColumnsCount: () => 3,
    handleFileClick: mockHandleFileClick,
    handleFileDoubleClick: mockHandleFileDoubleClick,
    needsVirtualization: false,
    virtualizer: { scrollToIndex: mockScrollToIndex },
    onQuickLook: mockOnQuickLook,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createKeyboardEvent(
    key: string,
    options: Partial<React.KeyboardEvent<HTMLDivElement>> = {},
  ) {
    return {
      key,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: createMockContainer(),
      ...options,
    } as unknown as React.KeyboardEvent<HTMLDivElement>;
  }

  function createMockContainer() {
    const items = sampleFiles.map((f, _i) => {
      const el = document.createElement('div');
      el.setAttribute('role', 'option');
      el.setAttribute('data-file-path', f.path);
      el.focus = vi.fn();
      el.scrollIntoView = vi.fn();
      return el;
    });

    const container = document.createElement('div');
    items.forEach((item) => container.appendChild(item));

    return {
      querySelectorAll: (selector: string) => {
        if (selector === '[role="option"]') return items;
        return [];
      },
      querySelector: (selector: string) => {
        return (
          items.find((el) => selector.includes(el.getAttribute('data-file-path') || '')) || null
        );
      },
    } as unknown as HTMLDivElement;
  }

  it('returns handleKeyDown function', () => {
    const { result } = renderHook(() => useGridKeyboardNav(defaultOptions));
    expect(typeof result.current.handleKeyDown).toBe('function');
  });

  it('uses the focused file path in a partially mounted virtual list', () => {
    const container = document.createElement('div');
    const row = document.createElement('div');
    row.dataset.filePath = '/d.txt';
    row.tabIndex = 0;
    container.appendChild(row);
    document.body.appendChild(container);
    row.focus();
    try {
      const { result } = renderHook(() =>
        useGridKeyboardNav({ ...defaultOptions, viewMode: 'list', needsVirtualization: true }),
      );
      result.current.handleKeyDown(createKeyboardEvent('ArrowDown', { currentTarget: container }));
      expect(mockHandleFileClick).toHaveBeenCalledWith(sampleFiles[4], expect.any(Object));
      expect(mockScrollToIndex).toHaveBeenCalledWith(1, { align: 'auto' });
      result.current.handleKeyDown(createKeyboardEvent('End', { currentTarget: container }));
      expect(mockHandleFileClick).toHaveBeenLastCalledWith(sampleFiles[5], expect.any(Object));
    } finally {
      container.remove();
    }
  });

  it('resolves preview neighbours from the displayed order without moving preview focus', () => {
    const container = document.createElement('div');
    const preview = document.createElement('button');
    document.body.append(container, preview);
    preview.focus();
    try {
      const { unmount } = renderHook(() =>
        useGridKeyboardNav({
          ...defaultOptions,
          files: [sampleFiles[2], sampleFiles[0], sampleFiles[5]],
          containerRef: { current: container },
        }),
      );
      expect(requestAdjacentFile('/c.txt', 1)).toEqual(sampleFiles[0]);
      expect(mockHandleFileClick).toHaveBeenLastCalledWith(sampleFiles[0], expect.any(Object));
      expect(document.activeElement).toBe(preview);
      expect(requestAdjacentFile('/f.txt', 1)).toEqual(sampleFiles[5]);
      expect(requestAdjacentFile('/not-visible.txt', 1)).toBeNull();
      unmount();
      expect(requestAdjacentFile('/c.txt', 1)).toBeNull();
    } finally {
      container.remove();
      preview.remove();
    }
  });

  it('ignores non-navigation keys', () => {
    const { result } = renderHook(() => useGridKeyboardNav(defaultOptions));
    const event = createKeyboardEvent('a');
    result.current.handleKeyDown(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mockHandleFileClick).not.toHaveBeenCalled();
  });

  it('ignores keys when files array is empty', () => {
    const { result } = renderHook(() => useGridKeyboardNav({ ...defaultOptions, files: [] }));
    const event = createKeyboardEvent('ArrowRight');
    result.current.handleKeyDown(event);
    expect(mockHandleFileClick).not.toHaveBeenCalled();
  });

  it('handles Enter key - renames focused file (Finder behaviour)', () => {
    const { result } = renderHook(() => useGridKeyboardNav(defaultOptions));
    const renameEvents: CustomEvent[] = [];
    const listener = (e: Event) => renameEvents.push(e as CustomEvent);
    window.addEventListener('start-inline-rename', listener);
    try {
      const event = createKeyboardEvent('Enter');
      result.current.handleKeyDown(event);
      expect(mockHandleFileDoubleClick).not.toHaveBeenCalled();
      expect(renameEvents).toHaveLength(1);
      expect(renameEvents[0].detail).toEqual({ path: sampleFiles[0].path });
    } finally {
      window.removeEventListener('start-inline-rename', listener);
    }
  });

  it('handles Space key - triggers Quick Look', () => {
    const { result } = renderHook(() => useGridKeyboardNav(defaultOptions));
    const event = createKeyboardEvent(' ');
    result.current.handleKeyDown(event);
    expect(mockOnQuickLook).toHaveBeenCalledWith(sampleFiles[0]);
  });

  it('handles ArrowRight - moves to next file', () => {
    const { result } = renderHook(() => useGridKeyboardNav(defaultOptions));
    const event = createKeyboardEvent('ArrowRight');
    result.current.handleKeyDown(event);
    // Should select the second file (index 1)
    expect(mockHandleFileClick).toHaveBeenCalledWith(
      sampleFiles[1],
      expect.objectContaining({ shiftKey: false }),
    );
  });

  it('handles ArrowLeft - moves to previous file', () => {
    const selectedFiles = new Set(['/b.txt']);
    const { result } = renderHook(() => useGridKeyboardNav({ ...defaultOptions, selectedFiles }));
    const event = createKeyboardEvent('ArrowLeft');
    result.current.handleKeyDown(event);
    // From first selected (b.txt at index 1), ArrowLeft should go to index 0
    expect(mockHandleFileClick).toHaveBeenCalledWith(
      sampleFiles[0],
      expect.objectContaining({ shiftKey: false }),
    );
  });

  it('handles ArrowDown - moves down by columns count', () => {
    const { result } = renderHook(() => useGridKeyboardNav(defaultOptions));
    const event = createKeyboardEvent('ArrowDown');
    result.current.handleKeyDown(event);
    // In grid mode with 3 columns, from index 0 should go to index 3
    expect(mockHandleFileClick).toHaveBeenCalledWith(
      sampleFiles[3],
      expect.objectContaining({ shiftKey: false }),
    );
  });

  it('handles ArrowUp - moves up by columns count', () => {
    const selectedFiles = new Set(['/d.txt']);
    const { result } = renderHook(() => useGridKeyboardNav({ ...defaultOptions, selectedFiles }));
    const event = createKeyboardEvent('ArrowUp');
    result.current.handleKeyDown(event);
    // From d.txt (index 3), ArrowUp should go to index 0
    expect(mockHandleFileClick).toHaveBeenCalledWith(
      sampleFiles[0],
      expect.objectContaining({ shiftKey: false }),
    );
  });

  it('handles Home - goes to first file', () => {
    const selectedFiles = new Set(['/d.txt']);
    const { result } = renderHook(() => useGridKeyboardNav({ ...defaultOptions, selectedFiles }));
    const event = createKeyboardEvent('Home');
    result.current.handleKeyDown(event);
    expect(mockHandleFileClick).toHaveBeenCalledWith(
      sampleFiles[0],
      expect.objectContaining({ shiftKey: false }),
    );
  });

  it('handles End - goes to last file', () => {
    const { result } = renderHook(() => useGridKeyboardNav(defaultOptions));
    const event = createKeyboardEvent('End');
    result.current.handleKeyDown(event);
    expect(mockHandleFileClick).toHaveBeenCalledWith(
      sampleFiles[5],
      expect.objectContaining({ shiftKey: false }),
    );
  });

  it('Shift+Arrow extends selection', () => {
    const { result } = renderHook(() => useGridKeyboardNav(defaultOptions));
    const event = createKeyboardEvent('ArrowRight', { shiftKey: true } as Record<string, unknown>);
    result.current.handleKeyDown(event);
    expect(mockHandleFileClick).toHaveBeenCalledWith(
      sampleFiles[1],
      expect.objectContaining({ shiftKey: true }),
    );
  });

  it('uses columns=1 in list view mode', () => {
    const { result } = renderHook(() =>
      useGridKeyboardNav({ ...defaultOptions, viewMode: 'list' }),
    );
    // ArrowDown in list mode should go to next file (1 column)
    const event = createKeyboardEvent('ArrowDown');
    result.current.handleKeyDown(event);
    expect(mockHandleFileClick).toHaveBeenCalledWith(sampleFiles[1], expect.any(Object));
  });

  it('scrolls to index when virtualization is needed', () => {
    const { result } = renderHook(() =>
      useGridKeyboardNav({ ...defaultOptions, needsVirtualization: true }),
    );
    const event = createKeyboardEvent('ArrowRight');
    result.current.handleKeyDown(event);
    expect(mockScrollToIndex).toHaveBeenCalled();
  });

  it('does not scroll when virtualization is not needed', () => {
    const { result } = renderHook(() => useGridKeyboardNav(defaultOptions));
    const event = createKeyboardEvent('ArrowRight');
    result.current.handleKeyDown(event);
    expect(mockScrollToIndex).not.toHaveBeenCalled();
  });

  it('does not handle key events when input is focused', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const { result } = renderHook(() => useGridKeyboardNav(defaultOptions));
    const event = createKeyboardEvent('ArrowRight');
    result.current.handleKeyDown(event);
    expect(event.preventDefault).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });
});
