import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import PathBreadcrumbs from '@/components/explorer/PathBreadcrumbs';

const segments = ['/', 'Users', 'alex', 'Projects', 'Current'].map((name, index, names) => ({
  name,
  fullPath: names.slice(0, index + 1).join('/'),
}));
let available = 180;
let resize: () => void;
beforeEach(() => {
  available = 180;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
    return this.classList.contains('wisp-breadcrumb-trail') ? available : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width: 64,
    height: 28,
    x: 0,
    y: 0,
    top: 0,
    bottom: 28,
    left: 0,
    right: 64,
    toJSON: () => ({}),
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PathBreadcrumbs', () => {
  it('shows nearest parent and current location, with hidden ancestors in a keyboard menu', () => {
    const navigate = vi.fn();
    render(
      <PathBreadcrumbs
        segments={segments}
        currentPath="/Users/alex/Projects/Current"
        navigateToPath={navigate}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Navigate to Current' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    expect(screen.getByRole('button', { name: 'Navigate to Projects' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Navigate to Users' })).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Show parent folders' });
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: '/' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(within(menu).getByRole('menuitem', { name: 'Users' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'alex' }));
    expect(navigate).toHaveBeenCalledWith('//Users/alex');
  });
  it('recomputes visible ancestors on pane resize without a viewport breakpoint', () => {
    render(
      <PathBreadcrumbs
        segments={segments}
        currentPath="/Users/alex/Projects/Current"
        onEdit={vi.fn()}
      />,
    );
    act(() => {
      available = 500;
      resize();
    });
    expect(screen.queryByRole('button', { name: 'Show parent folders' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Navigate to Users' })).toBeInTheDocument();
  });
  it('offers full path editing without triggering a parent click handler', () => {
    const edit = vi.fn();
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <PathBreadcrumbs
          segments={segments}
          currentPath="/Users/alex/Projects/Current"
          onEdit={edit}
        />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show parent folders' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show full path' }));
    expect(edit).toHaveBeenCalledOnce();
    expect(parentClick).not.toHaveBeenCalled();
  });
});
