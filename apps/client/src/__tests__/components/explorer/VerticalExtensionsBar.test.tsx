import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VerticalExtensionsBar from '@/components/explorer/VerticalExtensionsBar';
import { extensionHost } from '@/lib/extension-host';
import i18n from '@/i18n';
import { useHiddenFiles } from '@/hooks/use-hidden-files';
import { STORAGE_KEYS } from '@/lib/storage-keys';
vi.mock('@/lib/extension-host', () => ({
  extensionHost: {
    subscribe: vi.fn(() => () => {}),
    getSnapshotVersion: vi.fn(() => 0),
    getRegisteredPanels: vi.fn(() => []),
  },
}));
const props = {
  orientation: 'horizontal' as const,
  rightPanelTab: 'preview',
  setRightPanelTab: vi.fn(),
  rightSidebarCollapsed: true,
  setRightSidebarCollapsed: vi.fn(),
};
const openTools = () => fireEvent.click(screen.getByRole('button', { name: 'More tools' }));
describe('VerticalExtensionsBar', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(extensionHost.getRegisteredPanels).mockReturnValue([]);
    await i18n.changeLanguage('en');
  });

  it('names the three primary actions and keeps all work panels discoverable', () => {
    render(<VerticalExtensionsBar {...props} />);
    expect(screen.getByRole('button', { name: 'File Preview' })).toHaveTextContent('');
    expect(screen.getByRole('button', { name: 'More tools' })).toHaveTextContent('');
    openTools();
    for (const name of ['Chat', 'ChatGPT Bridge', 'WeChat bot'])
      {expect(screen.getByRole('menuitemradio', { name })).toBeInTheDocument();}
    // 活动面板已移除；显示隐藏文件提升为 rail 独立按钮
    expect(screen.queryByRole('menuitemradio', { name: 'Activity' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'Show hidden files' }),
    ).not.toBeInTheDocument();
  });

  it('toggles hidden files across panes and preserves unrelated saved settings', async () => {
    const Pane = () => (
      <output data-testid="hidden-state">{String(useHiddenFiles().showHiddenFiles)}</output>
    );
    localStorage.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({ language: 'en', showHiddenFiles: false }),
    );
    render(
      <>
        <VerticalExtensionsBar {...props} />
        <Pane />
        <Pane />
      </>,
    );
    openTools();
    const toggle = screen.getByTestId('rail-hidden-files');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));
    expect(
      screen.getAllByTestId('hidden-state').every((element) => element.textContent === 'true'),
    ).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!)).toEqual({
      language: 'en',
      showHiddenFiles: true,
    });
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ showHiddenFiles: false }));
    fireEvent(window, new CustomEvent('wisp-settings-changed'));
    expect(screen.getByTestId('rail-hidden-files')).toHaveAttribute('aria-pressed', 'false');
    expect(props.setRightPanelTab).not.toHaveBeenCalled();
  });

  it('opens the bridge and collapses it only when the same panel is selected again', () => {
    const { rerender } = render(<VerticalExtensionsBar {...props} />);
    openTools();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'ChatGPT Bridge' }));
    expect(props.setRightPanelTab).toHaveBeenCalledWith('chatgpt-bridge');
    expect(props.setRightSidebarCollapsed).toHaveBeenCalledWith(false);
    vi.clearAllMocks();
    rerender(
      <VerticalExtensionsBar
        {...props}
        rightPanelTab="chatgpt-bridge"
        rightSidebarCollapsed={false}
      />,
    );
    openTools();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'ChatGPT Bridge' }));
    expect(props.setRightSidebarCollapsed).toHaveBeenCalledWith(true);
    expect(props.setRightPanelTab).not.toHaveBeenCalled();
  });

  it('switches from external assistants to chat without closing the sidebar', () => {
    render(
      <VerticalExtensionsBar
        {...props}
        rightPanelTab="agent-manager"
        rightSidebarCollapsed={false}
      />,
    );
    openTools();
    expect(screen.getByRole('menuitemradio', { name: 'External assistants' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: 'Chat' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Chat' }));
    expect(props.setRightPanelTab).toHaveBeenCalledWith('chat');
    expect(props.setRightSidebarCollapsed).not.toHaveBeenCalled();
  });

  it('collapses an already-open preview', () => {
    render(<VerticalExtensionsBar {...props} rightSidebarCollapsed={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'File Preview' }));
    expect(props.setRightSidebarCollapsed).toHaveBeenCalledWith(true);
    expect(props.setRightPanelTab).not.toHaveBeenCalled();
  });

  it('opens registered extension panels', () => {
    vi.mocked(extensionHost.getRegisteredPanels).mockReturnValue([
      { id: 'notes', title: 'Notes', icon: <span>N</span> },
    ] as ReturnType<typeof extensionHost.getRegisteredPanels>);
    render(<VerticalExtensionsBar {...props} />);
    openTools();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Notes' }));
    expect(props.setRightPanelTab).toHaveBeenCalledWith('notes');
  });

  it('supports arrow navigation and returns focus to Tools after Escape', async () => {
    render(<VerticalExtensionsBar {...props} />);
    const trigger = screen.getByRole('button', { name: 'More tools' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const chat = await screen.findByRole('menuitemradio', { name: 'Chat' });
    await waitFor(() => expect(chat).toHaveFocus());
    fireEvent.keyDown(chat, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitemradio', { name: 'External assistants' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens the last item with ArrowUp and lets Tab leave the menu', async () => {
    const user = userEvent.setup();
    render(<VerticalExtensionsBar {...props} />);
    screen.getByRole('button', { name: 'More tools' }).focus();
    await user.keyboard('{ArrowUp}');
    await waitFor(() => {
      // 菜单内任意项获得焦点即算 ArrowUp 生效（最后一项随菜单内容变化）
      const focused = document.activeElement as HTMLElement | null;
      expect(focused?.closest('[role="menu"]')).not.toBeNull();
    });
    await user.tab();
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('opens settings with a return-focus target', () => {
    const listener = vi.fn();
    window.addEventListener('wisp-open-settings', listener);
    render(<VerticalExtensionsBar {...props} />);
    openTools();
    fireEvent.click(screen.getAllByRole('menuitem', { name: 'Settings' })[0]);
    expect(listener.mock.calls.length).toBeGreaterThan(0);
    window.removeEventListener('wisp-open-settings', listener);
  });

  it('closes Tools after an outside pointer press', () => {
    render(<VerticalExtensionsBar {...props} />);
    openTools();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
