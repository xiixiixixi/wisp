import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import TopBar from '@/components/explorer/TopBar';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isMaximized: vi.fn(() => Promise.resolve(false)),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    startDragging: vi.fn(),
    onResized: vi.fn(() => Promise.resolve(() => {})),
  }),
}));

vi.mock('@/lib/constants', () => ({
  ROOT_PATH: 'C:\\',
  isWindows: true,
  PATH_SEPARATOR: '\\',
}));

describe('TopBar', () => {
  const mockProps = {
    leftSidebarCollapsed: false,
    setLeftSidebarCollapsed: vi.fn(),
    onSplitRight: vi.fn(),
    onSplitDown: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('renders the application title', () => {
      render(<TopBar {...mockProps} />);
      expect(screen.getByText('Wisp')).toBeInTheDocument();
    });

    it('renders the sidebar toggle button', () => {
      render(<TopBar {...mockProps} />);
      expect(screen.getByRole('button', { name: 'Toggle sidebar' })).toBeInTheDocument();
    });
  });

  describe('Sidebar Toggle', () => {
    it('calls setLeftSidebarCollapsed when toggle button is clicked', () => {
      render(<TopBar {...mockProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
      expect(mockProps.setLeftSidebarCollapsed).toHaveBeenCalledWith(true);
    });
  });

  describe('Navigation Controls', () => {
    // Navigation moved to each pane's address bar (NavigationBar), right
    // next to the file window it acts on — the top bar no longer hosts it.
    it('does not render navigation buttons', () => {
      render(<TopBar {...mockProps} />);
      expect(screen.queryByTitle('Go back in history')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Go forward in history')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Go up one level')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Refresh')).not.toBeInTheDocument();
    });
  });

  describe('Tabs', () => {
    // Tabs live in each split pane's own tab bar (PaneTabBar); the title bar
    // no longer duplicates them.
    it('does not render a tab strip or new-tab button', () => {
      render(<TopBar {...mockProps} />);
      expect(screen.queryByTitle('New tab (Ctrl+T)')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'New tab' })).not.toBeInTheDocument();
    });
  });

  describe('Split Controls', () => {
    it('calls onSplitRight when split right button is clicked', () => {
      render(<TopBar {...mockProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Split right' }));
      expect(mockProps.onSplitRight).toHaveBeenCalled();
    });

    it('calls onSplitDown when split down button is clicked', () => {
      render(<TopBar {...mockProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Split down' }));
      expect(mockProps.onSplitDown).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('handles missing optional props', () => {
      const minimalProps = {
        leftSidebarCollapsed: false,
        setLeftSidebarCollapsed: vi.fn(),
      };
      expect(() => render(<TopBar {...minimalProps} />)).not.toThrow();
    });
  });
});
