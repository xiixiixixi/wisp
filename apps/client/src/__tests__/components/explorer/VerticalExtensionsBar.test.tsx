import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VerticalExtensionsBar from '@/components/explorer/VerticalExtensionsBar';
import { extensionHost } from '@/lib/extension-host';
import i18n from '@/i18n';

vi.mock('@/lib/extension-host', () => ({
  extensionHost: {
    subscribe: vi.fn(() => () => {}),
    getSnapshotVersion: vi.fn(() => 0),
    getRegisteredPanels: vi.fn(() => []),
  },
}));

describe('VerticalExtensionsBar', () => {
  const defaultProps = {
    orientation: 'horizontal' as const,
    rightPanelTab: 'preview',
    setRightPanelTab: vi.fn(),
    rightSidebarCollapsed: true,
    setRightSidebarCollapsed: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(extensionHost.getRegisteredPanels).mockReturnValue([]);
    await i18n.changeLanguage('en');
  });

  it('keeps Preview visible and progressively discloses the other built-in tools', () => {
    render(<VerticalExtensionsBar {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'File Preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More tools' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'Agent' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'More tools' }));

    expect(screen.getByRole('menu', { name: 'More tools' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Agent' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Marketplace' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument();
  });

  it('opens Preview directly and folds it when pressed again', () => {
    const setRightPanelTab = vi.fn();
    const setRightSidebarCollapsed = vi.fn();
    const { rerender } = render(
      <VerticalExtensionsBar
        {...defaultProps}
        setRightPanelTab={setRightPanelTab}
        setRightSidebarCollapsed={setRightSidebarCollapsed}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'File Preview' }));
    expect(setRightPanelTab).toHaveBeenCalledWith('preview');
    expect(setRightSidebarCollapsed).toHaveBeenCalledWith(false);

    vi.clearAllMocks();
    rerender(
      <VerticalExtensionsBar
        {...defaultProps}
        rightSidebarCollapsed={false}
        setRightPanelTab={setRightPanelTab}
        setRightSidebarCollapsed={setRightSidebarCollapsed}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'File Preview' }));
    expect(setRightSidebarCollapsed).toHaveBeenCalledWith(true);
    expect(setRightPanelTab).not.toHaveBeenCalled();
  });

  it('maps Agent to its panel, expands the sidebar, and marks More as active', () => {
    const setRightPanelTab = vi.fn();
    const setRightSidebarCollapsed = vi.fn();
    const { rerender } = render(
      <VerticalExtensionsBar
        {...defaultProps}
        setRightPanelTab={setRightPanelTab}
        setRightSidebarCollapsed={setRightSidebarCollapsed}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'More tools' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Agent' }));
    expect(setRightPanelTab).toHaveBeenCalledWith('agent-manager');
    expect(setRightSidebarCollapsed).toHaveBeenCalledWith(false);

    rerender(
      <VerticalExtensionsBar
        {...defaultProps}
        rightPanelTab="agent-manager"
        rightSidebarCollapsed={false}
        setRightPanelTab={setRightPanelTab}
        setRightSidebarCollapsed={setRightSidebarCollapsed}
      />,
    );
    expect(screen.getByRole('button', { name: 'More tools' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('includes registered extension panels in the More menu', () => {
    vi.mocked(extensionHost.getRegisteredPanels).mockReturnValue([
      { id: 'notes-panel', title: 'Notes', icon: <span aria-hidden="true">N</span> },
    ] as ReturnType<typeof extensionHost.getRegisteredPanels>);

    render(<VerticalExtensionsBar {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'More tools' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Notes' }));

    expect(defaultProps.setRightPanelTab).toHaveBeenCalledWith('notes-panel');
    expect(defaultProps.setRightSidebarCollapsed).toHaveBeenCalledWith(false);
  });

  it('supports arrow navigation and returns focus to More on Escape', async () => {
    render(<VerticalExtensionsBar {...defaultProps} />);
    const trigger = screen.getByRole('button', { name: 'More tools' });

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const agent = await screen.findByRole('menuitemradio', { name: 'Agent' });
    await waitFor(() => expect(agent).toHaveFocus());

    fireEvent.keyDown(agent, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitemradio', { name: 'Activity' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens on the last item with ArrowUp and preserves normal Tab order', async () => {
    const user = userEvent.setup();
    render(
      <>
        <VerticalExtensionsBar {...defaultProps} />
        <button type="button">After toolbar</button>
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'More tools' });

    trigger.focus();
    await user.keyboard('{ArrowUp}');
    const settings = await screen.findByRole('menuitem', { name: 'Settings' });
    await waitFor(() => expect(settings).toHaveFocus());

    await user.tab();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'After toolbar' })).toHaveFocus(),
    );
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('closes the More menu when focus moves to an outside pointer target', () => {
    render(<VerticalExtensionsBar {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'More tools' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
