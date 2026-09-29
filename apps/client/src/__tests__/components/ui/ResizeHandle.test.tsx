import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
import ResizeHandle from '@/components/ui/ResizeHandle';
import {
  containsNavigationPath,
  currentNavigationLocation,
} from '@/components/explorer/sidebar/navigation-path';

describe('ResizeHandle', () => {
  it('supports small and large keyboard changes and reports the current width', () => {
    const resize = vi.fn();
    const end = vi.fn();
    render(
      <ResizeHandle
        direction="horizontal"
        onResize={resize}
        onResizeEnd={end}
        ariaLabel="Navigation width"
        value={240}
        min={180}
        max={400}
      />,
    );
    const handle = screen.getByRole('separator', { name: 'Navigation width' });
    expect(handle).toHaveAttribute('tabindex', '0');
    expect(handle).toHaveAttribute('aria-valuenow', '240');
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyUp(handle, { key: 'ArrowLeft' });
    expect(resize.mock.calls).toEqual([[8], [-32]]);
    expect(end).toHaveBeenCalledOnce();
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(resize).toHaveBeenCalledTimes(2);
  });

  it('uses up and down for height and ignores a right mouse press', () => {
    const resize = vi.fn();
    render(<ResizeHandle direction="vertical" onResize={resize} />);
    const handle = screen.getByRole('separator');
    fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true });
    expect(resize).toHaveBeenCalledWith(32);
    fireEvent.mouseDown(handle, { button: 2, clientY: 10 });
    fireEvent.mouseMove(document, { clientY: 50 });
    expect(resize).toHaveBeenCalledTimes(1);
  });

  it('restores drag state and removes document listeners when unmounted mid-drag', () => {
    const resize = vi.fn();
    document.body.style.cursor = 'crosshair';
    document.body.style.userSelect = 'text';
    const { unmount } = render(<ResizeHandle direction="horizontal" onResize={resize} />);
    fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 120 });
    expect(resize).toHaveBeenCalledWith(20);
    unmount();
    fireEvent.mouseMove(document, { clientX: 170 });
    expect(resize).toHaveBeenCalledTimes(1);
    expect(document.body.style.cursor).toBe('crosshair');
    expect(document.body.style.userSelect).toBe('text');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
});

describe('Navigation location matching', () => {
  it('matches descendants at path boundaries and picks the most specific location', () => {
    expect(containsNavigationPath('/Users/amy', '/Users/amy2')).toBe(false);
    expect(
      currentNavigationLocation(
        ['/', '/Users/amy', '/Users/amy/Documents'],
        '/Users/amy/Documents/reports',
      ),
    ).toBe('/Users/amy/Documents');
    expect(containsNavigationPath('C:\\Users\\Amy', 'c:/users/amy/Documents')).toBe(true);
    expect(containsNavigationPath('/', 'wisp://tag/Red')).toBe(false);
  });
});
