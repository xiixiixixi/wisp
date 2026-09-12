import { useState, type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
