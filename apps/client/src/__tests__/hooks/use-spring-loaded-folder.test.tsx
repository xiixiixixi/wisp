import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  isLiveSpringLoadTarget,
  springLoadedFolderDetail,
  useSpringLoadedFolder,
} from '@/hooks/use-spring-loaded-folder';

describe('spring-loaded folder navigation', () => {
  it('reads the destination pane from a nested folder drop target', () => {
    const left = document.createElement('div');
    left.dataset.groupId = 'left';
    const right = document.createElement('div');
    right.dataset.groupId = 'right';
    const folder = document.createElement('div');
    folder.dataset.dropTarget = '/destination/folder';
    right.appendChild(folder);
    document.body.append(left, right);

    expect(springLoadedFolderDetail(folder, '/destination/folder')).toEqual({
      path: '/destination/folder',
      groupId: 'right',
    });

    left.remove();
    right.remove();
  });

  it('discards a delayed spring load after its original folder unmounts or the cursor moves', () => {
    const folder = document.createElement('div');
    const otherFolder = document.createElement('div');
    document.body.append(folder, otherFolder);
    const original = { element: folder, path: '/destination/folder' };

    expect(isLiveSpringLoadTarget(true, true, original, original)).toBe(true);
    expect(
      isLiveSpringLoadTarget(true, true, original, {
        element: otherFolder,
        path: '/destination/folder',
      }),
    ).toBe(false);
    expect(isLiveSpringLoadTarget(false, true, original, original)).toBe(false);
    folder.remove();
    expect(isLiveSpringLoadTarget(true, true, original, original)).toBe(false);
    otherFolder.remove();
  });

  it('opens a cross-pane drag target only in the target pane', () => {
    const navigate = vi.fn();
    const { result } = renderHook(() => {
      const consumeLeft = useSpringLoadedFolder('left', '/source', navigate);
      const consumeRight = useSpringLoadedFolder('right', '/destination', navigate);
      return { consumeLeft, consumeRight };
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('spring-load-folder', {
          detail: { path: '/destination/folder', groupId: 'right' },
        }),
      );
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('right', '/destination/folder', 'folder');
    // The target pane's sync effect consumes this mark and does not mirror
    // the drag navigation back to the source pane.
    expect(result.current.consumeRight('/destination/folder')).toBe(true);
    expect(result.current.consumeLeft('/destination/folder')).toBe(false);
    expect(result.current.consumeRight('/destination/folder')).toBe(false);
  });

  it('keeps same-pane spring loading and ignores the current folder', () => {
    const navigate = vi.fn();
    renderHook(() => useSpringLoadedFolder('left', '/source', navigate));

    act(() => {
      window.dispatchEvent(
        new CustomEvent('spring-load-folder', { detail: { path: '/source', groupId: 'left' } }),
      );
      window.dispatchEvent(
        new CustomEvent('spring-load-folder', {
          detail: { path: '/source/subfolder', groupId: 'left' },
        }),
      );
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('left', '/source/subfolder', 'subfolder');
  });
});
