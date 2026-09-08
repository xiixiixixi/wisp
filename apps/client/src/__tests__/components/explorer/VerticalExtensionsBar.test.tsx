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
    localStorage.clear();
    vi.mocked(extensionHost.getRegisteredPanels).mockReturnValue([]);
    await i18n.changeLanguage('en');
  });

  describe('Hidden files', () => {
    it('sits directly beside Preview and changes only its icon when toggled', () => {
      render(<VerticalExtensionsBar {...defaultProps} />);
      const toggle = screen.getByRole('button', { name: 'Show Hidden Files' });
      const preview = screen.getByRole('button', { name: 'File Preview' });
      expect(preview.nextElementSibling).toBe(toggle);
      expect(toggle.closest('.wisp-panel-rail-horizontal')).toBe(
        preview.closest('.wisp-panel-rail-horizontal'),
      );
      expect(toggle).not.toHaveClass('wisp-rail-button');
      const neutralClass = toggle.className;
      expect(toggle.querySelector('svg')).toHaveClass('lucide-file');
      expect(toggle.querySelector('svg')).toHaveAttribute('stroke-dasharray', '2.5 2.5');
      expect(toggle.querySelector('circle')).toHaveAttribute('cx', '8');
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      expect(toggle.className).toBe(neutralClass);
      expect(toggle.querySelector('svg')).toHaveClass('lucide-file');
      expect(toggle.querySelector('svg')).not.toHaveAttribute('stroke-dasharray');
      expect(toggle.querySelector('svg')).not.toHaveClass('lucide-files');
      expect(defaultProps.setRightPanelTab).not.toHaveBeenCalled();
    });

    const PaneState = () => {
      const { showHiddenFiles } = useHiddenFiles();
      return <output data-testid="pane-hidden-state">{String(showHiddenFiles)}</output>;
    };

    it('toggles hidden files for all panes and persists without losing other settings', () => {
      localStorage.setItem(
        STORAGE_KEYS.SETTINGS,
        JSON.stringify({ language: 'en', showHiddenFiles: false }),
      );
      render(
        <>
          <VerticalExtensionsBar {...defaultProps} />
          <PaneState />
          <PaneState />
        </>,
      );
      const toggle = screen.getByRole('button', { name: 'Show Hidden Files' });
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      expect(
        screen.getAllByTestId('pane-hidden-state').every((el) => el.textContent === 'true'),
      ).toBe(true);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS)!)).toEqual({
        language: 'en',
        showHiddenFiles: true,
      });
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
    });

    it('restores the saved state and follows shortcut updates', () => {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ showHiddenFiles: true }));
      render(<VerticalExtensionsBar {...defaultProps} />);
      const toggle = screen.getByRole('button', { name: 'Show Hidden Files' });
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ showHiddenFiles: false }));
      fireEvent(window, new CustomEvent('wisp-settings-changed'));
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
    });
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
