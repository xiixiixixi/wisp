import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import BottomPanel from '@/components/panels/BottomPanel';

const { mockIsBrowserDemoMode, mockUseActivityFeed } = vi.hoisted(() => ({
  mockIsBrowserDemoMode: vi.fn(() => false),
  mockUseActivityFeed: vi.fn(() => ({ entries: [], clearFeed: vi.fn() })),
}));

// Helper to render with Suspense boundary for lazy-loaded child components
const renderWithSuspense = (ui: React.ReactElement) => {
  return render(<React.Suspense fallback={<div>Loading...</div>}>{ui}</React.Suspense>);
};

// Mock sub-panels (lazy-loaded)
vi.mock('@/components/panels/XTermPanel', () => ({
  default: (props: Record<string, unknown> & { terminalCwd?: string }) => (
    <div data-testid="terminal-panel">Terminal: {props.terminalCwd}</div>
  ),
}));
vi.mock('@/components/panels/EventsPanel', () => ({
  default: ({ fileChanges }: { fileChanges?: { totalCount?: number } | null }) => (
    <div data-testid="events-panel">Events: {fileChanges?.totalCount ?? 0}</div>
  ),
}));
vi.mock('@/components/panels/ClipboardHistoryPanel', () => ({
  default: ({ onPaste: _onPaste }: { onPaste?: () => void }) => (
    <div data-testid="clipboard-panel">Clipboard</div>
  ),
}));
vi.mock('@/hooks/use-notification-history', () => ({
  useNotificationHistory: () => ({
    unreadCount: 0,
    notifications: [],
    markAllAsRead: vi.fn(),
    clearAll: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-activity-feed', () => ({
  useActivityFeed: mockUseActivityFeed,
}));
vi.mock('@/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/browser-demo-files', () => ({
  isBrowserDemoMode: mockIsBrowserDemoMode,
}));
vi.mock('@/lib/extension-host', () => ({
  extensionHost: {
    subscribe: vi.fn(() => () => {}),
    getSnapshotVersion: vi.fn(() => 0),
    getBottomTabs: vi.fn(() => []),
    getBottomTabRenderer: vi.fn(() => null),
  },
}));

describe('BottomPanel', () => {
  const mockSetBottomPanelCollapsed = vi.fn();
  const mockSetBottomPanelTab = vi.fn();
  const mockOnPasteFromHistory = vi.fn();
  const mockOnNavigate = vi.fn();
  const mockOnDismissChanges = vi.fn();

  const defaultProps = {
    bottomPanelCollapsed: false,
    setBottomPanelCollapsed: mockSetBottomPanelCollapsed,
    bottomPanelTab: 'terminal' as const,
    setBottomPanelTab: mockSetBottomPanelTab,
    terminalCwd: 'C:\\Users\\Test',
    currentPath: 'C:\\Users\\Test',
    onNavigate: mockOnNavigate,
    onPasteFromHistory: mockOnPasteFromHistory,
    fileChanges: null,
    onDismissChanges: mockOnDismissChanges,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBrowserDemoMode.mockReturnValue(false);
    mockUseActivityFeed.mockReturnValue({ entries: [], clearFeed: vi.fn() });
  });

  describe('Collapsed state', () => {
    it('keeps the panel mounted but hidden when collapsed', () => {
      const { container } = render(<BottomPanel {...defaultProps} bottomPanelCollapsed={true} />);
      // Hidden instead of unmounted so terminal sessions survive collapse.
      expect(container.firstChild).not.toBeNull();
      expect((container.firstChild as HTMLElement).className).toContain('hidden');
    });

    it('renders when not collapsed', () => {
      const { container } = render(<BottomPanel {...defaultProps} />);
      expect(container.firstChild).not.toBeNull();
      expect((container.firstChild as HTMLElement).className).not.toContain('hidden');
    });
  });

  describe('Tab rendering', () => {
    it('renders the four core tab buttons', () => {
      render(<BottomPanel {...defaultProps} />);

      const tabs = ['Terminal', 'Events', 'Clipboard', 'Properties'];
      tabs.forEach((tab) => {
        expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument();
      });
      // The merged-away tabs are gone
      ['Activity Log', 'Changes', 'Notifications'].forEach((tab) => {
        expect(screen.queryByRole('tab', { name: tab })).not.toBeInTheDocument();
      });
    });

    it('highlights the active tab', () => {
      render(<BottomPanel {...defaultProps} bottomPanelTab="terminal" />);

      const terminalTab = screen.getByRole('tab', { name: 'Terminal' });
      expect(terminalTab).toHaveAttribute('aria-selected', 'true');
    });

    it('renders close button', () => {
      render(<BottomPanel {...defaultProps} />);

      const closeButton = screen.getByTitle(/Close \(Ctrl \+ J\)/);
      expect(closeButton).toBeInTheDocument();
    });
  });

  describe('Tab switching', () => {
    it('calls setBottomPanelTab when clicking a tab', () => {
      render(<BottomPanel {...defaultProps} />);

      fireEvent.click(screen.getByRole('tab', { name: 'Events' }));
      expect(mockSetBottomPanelTab).toHaveBeenCalledWith('events');
    });

    it('calls setBottomPanelTab with clipboard', () => {
      render(<BottomPanel {...defaultProps} />);

      fireEvent.click(screen.getByRole('tab', { name: 'Clipboard' }));
      expect(mockSetBottomPanelTab).toHaveBeenCalledWith('clipboard');
    });
  });

  describe('Collapse behavior', () => {
    it('calls setBottomPanelCollapsed(true) when close button clicked', () => {
      render(<BottomPanel {...defaultProps} />);

      fireEvent.click(screen.getByTitle(/Close \(Ctrl \+ J\)/));
      expect(mockSetBottomPanelCollapsed).toHaveBeenCalledWith(true);
    });
  });

  describe('Tab content', () => {
    it('shows terminal panel when terminal tab is active', async () => {
      renderWithSuspense(<BottomPanel {...defaultProps} bottomPanelTab="terminal" />);
      expect(await screen.findByTestId('terminal-panel')).toBeInTheDocument();
    });

    it('shows a desktop terminal placeholder in browser demo mode', () => {
      mockIsBrowserDemoMode.mockReturnValue(true);

      render(<BottomPanel {...defaultProps} bottomPanelTab="terminal" />);

      expect(screen.getByText('Desktop terminal')).toBeInTheDocument();
      expect(screen.getByText('Available in the Wisp desktop app')).toBeInTheDocument();
      expect(screen.queryByTestId('terminal-panel')).not.toBeInTheDocument();
    });

    it('shows the events panel when events tab is active and has content', async () => {
      mockUseActivityFeed.mockReturnValue({
        entries: [
          {
            id: 'a1',
            type: 'created' as const,
            path: '/tmp/a.txt',
            name: 'a.txt',
            timestamp: Date.now(),
          },
        ],
        clearFeed: vi.fn(),
      });
      renderWithSuspense(<BottomPanel {...defaultProps} bottomPanelTab="events" />);
      expect(await screen.findByTestId('events-panel')).toBeInTheDocument();
    });

    it('compacts the events tab to the tabbar while it has no content', () => {
      render(<BottomPanel {...defaultProps} bottomPanelTab="events" />);
      expect(screen.queryByTestId('events-panel')).not.toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Events' })).toBeInTheDocument();
    });

    it('shows clipboard panel when clipboard tab is active', async () => {
      renderWithSuspense(<BottomPanel {...defaultProps} bottomPanelTab="clipboard" />);
      expect(await screen.findByTestId('clipboard-panel')).toBeInTheDocument();
    });
  });

  describe('Badge counts', () => {
    it('shows the away-digest count badge on the events tab', () => {
      render(
        <BottomPanel
          {...defaultProps}
          fileChanges={{ totalCount: 3, added: [], removed: [], modified: [] } as unknown}
        />,
      );
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  describe('Height prop', () => {
    it('uses the compact default height when not specified', () => {
      const { container } = render(<BottomPanel {...defaultProps} />);
      const panel = container.firstChild as HTMLElement;
      expect(panel.style.height).toBe('148px');
    });

    it('uses custom height when specified', () => {
      const { container } = render(<BottomPanel {...defaultProps} height={300} />);
      const panel = container.firstChild as HTMLElement;
      expect(panel.style.height).toBe('300px');
    });
  });
});
