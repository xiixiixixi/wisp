import { useState, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { House, FolderClosed } from 'lucide-react';
import PaneTabBar from '@/components/split-view/PaneTabBar';
import { getTabIcon } from '@/lib/tab-utils';
import type { TabItem } from '@/types/split-view';

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));

type Props = ComponentProps<typeof PaneTabBar>;
const home: TabItem = { id: 'home', name: 'home', path: 'wisp://home', type: 'folder' };
const research: TabItem = {
  id: 'research',
  name: 'Research',
  path: '/Users/example/Research',
  type: 'folder',
};
const notes: TabItem = {
  id: 'notes',
  name: 'Notes.md',
  path: '/Users/example/Notes.md',
  type: 'editor',
};

const props: Props = {
  groupId: 'main',
  tabs: [home, research, notes],
  activeTabId: 'home',
  isActiveGroup: true,
  canClose: true,
  onSwitchTab: vi.fn(),
  onCloseTab: vi.fn(),
  onAddTab: vi.fn(),
  onSplitHorizontal: vi.fn(),
  onSplitVertical: vi.fn(),
  onCloseGroup: vi.fn(),
  onFocus: vi.fn(),
  onTogglePin: vi.fn(),
  onDuplicateTab: vi.fn(),
  onCloseOtherTabs: vi.fn(),
  onCloseTabsToRight: vi.fn(),
  onCloseAllTabs: vi.fn(),
  onReorderTab: vi.fn(),
  onMaximizePane: vi.fn(),
  onRestorePane: vi.fn(),
};

function ControlledTabs() {
  const [activeTabId, setActiveTabId] = useState('home');
  return (
    <PaneTabBar
      {...props}
      activeTabId={activeTabId}
      onSwitchTab={(tabId) => {
        props.onSwitchTab(tabId);
        setActiveTabId(tabId);
      }}
    />
  );
}

function dragData(values: Record<string, string> = {}) {
  return {
    types: Object.keys(values),
    effectAllowed: 'all',
    dropEffect: 'none',
    setData: vi.fn(),
    getData: (type: string) => values[type] ?? '',
  };
}

describe('PaneTabBar interactions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('displays the virtual home as Home without relabeling ordinary folders', () => {
    render(<PaneTabBar {...props} />);
    const tabs = within(screen.getByRole('tablist', { name: 'Pane tabs' })).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Home', 'Research', 'Notes.md']);
    expect(getTabIcon(home)).toBe(House);
    expect(getTabIcon({ ...research, name: 'home' })).toBe(FolderClosed);
  });

  it('switches and focuses tabs with arrows, Home, and End using one tab stop', async () => {
    const user = userEvent.setup();
    render(<ControlledTabs />);
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Research' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Research' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Notes.md' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}{Home}');
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveFocus();
    expect(screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
    expect(props.onSwitchTab).toHaveBeenLastCalledWith('home');
    expect(props.onFocus).toHaveBeenCalled();
  });

  it('closes a tab without switching to it and keeps pinned tabs protected', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PaneTabBar {...props} />);
    await user.click(screen.getByRole('button', { name: 'Close Research' }));
    expect(props.onCloseTab).toHaveBeenCalledWith('research');
    expect(props.onSwitchTab).not.toHaveBeenCalled();
    rerender(<PaneTabBar {...props} tabs={[home, { ...research, isPinned: true }]} />);
    expect(screen.queryByRole('button', { name: 'Close Research' })).not.toBeInTheDocument();
    rerender(<PaneTabBar {...props} tabs={[home]} />);
    expect(screen.queryByRole('button', { name: 'Close Home' })).not.toBeInTheDocument();
  });

  it('opens a keyboard menu, pins the invoking tab, and restores focus', async () => {
    const user = userEvent.setup();
    render(<PaneTabBar {...props} />);
    const tab = screen.getByRole('tab', { name: 'Home' });
    tab.focus();
    await user.keyboard('{Shift>}{F10}{/Shift}');
    expect(screen.getByRole('menuitem', { name: 'Pin Tab' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(props.onTogglePin).toHaveBeenCalledWith('home');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(tab).toHaveFocus();
    expect(props.onSwitchTab).not.toHaveBeenCalled();
  });

  it('moves tabs through the menu using original indices and respects pinned boundaries', async () => {
    const user = userEvent.setup();
    // Pinned order on screen differs from the underlying array.
    render(<PaneTabBar {...props} tabs={[research, { ...home, isPinned: true }, notes]} />);
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Research' }));
    expect(screen.getByRole('menuitem', { name: 'Move Tab Left' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(props.onReorderTab).toHaveBeenCalledWith(0, 2);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Research' })).toHaveFocus();
  });

  it('preserves drag reordering and rejects drops across the pinned boundary', () => {
    render(<PaneTabBar {...props} tabs={[research, { ...home, isPinned: true }, notes]} />);
    const first = screen.getByRole('tab', { name: 'Research' }).closest('[data-tab-item]')!;
    const second = screen.getByRole('tab', { name: 'Notes.md' }).closest('[data-tab-item]')!;
    const pinned = screen.getByRole('tab', { name: 'Home' }).closest('[data-tab-item]')!;
    const dataTransfer = dragData();
    fireEvent.dragStart(first, { dataTransfer });
    fireEvent.dragOver(second, { dataTransfer });
    fireEvent.drop(second, { dataTransfer });
    expect(props.onReorderTab).toHaveBeenCalledWith(0, 2);
    fireEvent.dragEnd(first, { dataTransfer });
    vi.mocked(props.onReorderTab!).mockClear();
    fireEvent.dragStart(first, { dataTransfer });
    fireEvent.dragOver(pinned, { dataTransfer });
    fireEvent.drop(pinned, { dataTransfer });
    fireEvent.dragEnd(first, { dataTransfer });
    expect(props.onReorderTab).not.toHaveBeenCalled();
  });

  it('keeps cross-tab file drops separate from reordering', () => {
    const onCrossTabDrop = vi.fn();
    render(<PaneTabBar {...props} onCrossTabDrop={onCrossTabDrop} />);
    const target = screen.getByRole('tab', { name: 'Research' }).closest('[data-tab-item]')!;
    const files = [{ path: '/Users/example/Notes.md', name: 'Notes.md' }];
    const dataTransfer = dragData({ 'application/x-wisp-cross-tab-files': JSON.stringify(files) });
    fireEvent.dragOver(target, { dataTransfer });
    expect(dataTransfer.dropEffect).toBe('copy');
    fireEvent.drop(target, { dataTransfer });
    expect(onCrossTabDrop).toHaveBeenCalledWith(research.path, files);
    expect(props.onReorderTab).not.toHaveBeenCalled();
    expect(props.onSwitchTab).not.toHaveBeenCalled();
  });

  it('preserves pane actions and maximize/restore behavior', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PaneTabBar {...props} />);
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    await user.click(screen.getByRole('button', { name: 'Split right' }));
    await user.click(screen.getByRole('button', { name: 'Split down' }));
    await user.click(screen.getByRole('button', { name: 'Maximize pane' }));
    await user.click(screen.getByRole('button', { name: 'Close pane' }));
    expect(props.onAddTab).toHaveBeenCalledOnce();
    expect(props.onSplitHorizontal).toHaveBeenCalledOnce();
    expect(props.onSplitVertical).toHaveBeenCalledOnce();
    expect(props.onMaximizePane).toHaveBeenCalledOnce();
    expect(props.onCloseGroup).toHaveBeenCalledOnce();
    rerender(<PaneTabBar {...props} isMaximized />);
    await user.click(screen.getByRole('button', { name: 'Restore pane' }));
    expect(props.onRestorePane).toHaveBeenCalledOnce();
    expect(props.onSwitchTab).not.toHaveBeenCalled();
  });
});

describe('PaneTabBar narrow panes', () => {
  const resizeCallbacks = new Map<Element, () => void>();

  beforeEach(() => {
    vi.clearAllMocks();
    resizeCallbacks.clear();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const width = Number(this.dataset.paneWidth) || 0;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: 30,
        width,
        height: 30,
        toJSON: () => ({}),
      };
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(target: Element) {
          resizeCallbacks.set(target, () => this.callback([], this as unknown as ResizeObserver));
        }
        unobserve(target: Element) {
          resizeCallbacks.delete(target);
        }
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const renderPane = (overrides: Partial<Props> = {}, width = 400) =>
    render(
      <div className="wisp-editor-pane" data-pane-width={width}>
        <PaneTabBar {...props} {...overrides} />
      </div>,
    );

  const resizePane = (pane: HTMLElement, width: number) => {
    pane.dataset.paneWidth = String(width);
    act(() => resizeCallbacks.get(pane)?.());
  };

  it('uses each pane width and keeps only new-tab and more controls at 480px or less', () => {
    const { container } = render(
      <>
        <div className="wisp-editor-pane" data-pane-width={480}>
          <PaneTabBar {...props} />
        </div>
        <div className="wisp-editor-pane" data-pane-width={481}>
          <PaneTabBar {...props} groupId="second" />
        </div>
      </>,
    );
    const actions = container.querySelectorAll<HTMLElement>('.wisp-pane-tab-actions');
    expect(
      within(actions[0])
        .getAllByRole('button')
        .map((button) => button.title),
    ).toEqual(['New tab', 'More']);
    expect(within(actions[1]).queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
    expect(within(actions[1]).getByRole('button', { name: 'Split right' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(6);
  });

  it('keeps all pane commands reachable and closes the menu after invoking them', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPane();
    const more = screen.getByRole('button', { name: 'More' });
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    const actions = [
      ['Split right', props.onSplitHorizontal],
      ['Split down', props.onSplitVertical],
      ['Maximize pane', props.onMaximizePane],
      ['Close pane', props.onCloseGroup],
    ] as const;
    for (const [label, callback] of actions) {
      await user.click(more);
      await user.click(screen.getByRole('menuitem', { name: label }));
      expect(callback).toHaveBeenCalledOnce();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(more).toHaveFocus();
    }
    expect(props.onAddTab).toHaveBeenCalledOnce();
    rerender(
      <div className="wisp-editor-pane" data-pane-width={400}>
        <PaneTabBar {...props} isMaximized />
      </div>,
    );
    await user.click(more);
    await user.click(screen.getByRole('menuitem', { name: 'Restore pane' }));
    expect(props.onRestorePane).toHaveBeenCalledOnce();
  });

  it('preserves sync toggling and both sync modes inside the menu', async () => {
    const user = userEvent.setup();
    const onTogglePaneSync = vi.fn();
    const onSwitchPaneSyncMode = vi.fn();
    const { rerender } = renderPane({
      hasMultiplePanes: true,
      paneSyncEnabled: true,
      paneSyncMode: 'mirror',
      onTogglePaneSync,
      onSwitchPaneSyncMode,
    });
    const more = screen.getByRole('button', { name: 'More' });
    await user.click(more);
    const sync = screen.getByRole('menuitemcheckbox', { name: 'Sync navigation' });
    expect(sync).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Mirror' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Relative' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await user.click(sync);
    expect(onTogglePaneSync).toHaveBeenCalledOnce();
    await user.click(more);
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Relative' }));
    expect(onSwitchPaneSyncMode).toHaveBeenCalledWith('relative');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    rerender(
      <div className="wisp-editor-pane" data-pane-width={400}>
        <PaneTabBar
          {...props}
          hasMultiplePanes
          paneSyncEnabled={false}
          paneSyncMode="relative"
          onTogglePaneSync={onTogglePaneSync}
          onSwitchPaneSyncMode={onSwitchPaneSyncMode}
        />
      </div>,
    );
    await user.click(more);
    expect(screen.getByRole('menuitemcheckbox', { name: 'Sync navigation' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Mirror' }));
    expect(onSwitchPaneSyncMode).toHaveBeenLastCalledWith('mirror');
  });

  it('omits unavailable sync and close/maximize commands', async () => {
    const user = userEvent.setup();
    renderPane({ canClose: false, hasMultiplePanes: false });
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Split right',
      'Split down',
    ]);
    expect(screen.queryByRole('menuitemcheckbox')).not.toBeInTheDocument();
  });

  it('supports keyboard opening, navigation, Escape, and outside dismissal', async () => {
    const user = userEvent.setup();
    renderPane();
    const more = screen.getByRole('button', { name: 'More' });
    more.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Split right' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(props.onSplitVertical).toHaveBeenCalledOnce();
    expect(more).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Close pane' })).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(more).toHaveFocus();
    await user.click(more);
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(more);
    await user.click(more);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(more);
    await user.click(screen.getByRole('tab', { name: 'Research' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(props.onSwitchTab).toHaveBeenCalledWith('research');
  });

  it('closes an open menu when resized and restores focus to a visible control', async () => {
    const user = userEvent.setup();
    const { container } = renderPane();
    const pane = container.firstElementChild as HTMLElement;
    await user.click(screen.getByRole('button', { name: 'More' }));
    resizePane(pane, 700);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New tab' })).toHaveFocus();
    const split = screen.getByRole('button', { name: 'Split right' });
    split.focus();
    resizePane(pane, 400);
    expect(screen.getByRole('button', { name: 'More' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'More' }));
    resizePane(pane, 350);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toHaveFocus();
  });
});
