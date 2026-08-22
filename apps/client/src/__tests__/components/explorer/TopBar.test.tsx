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
  const mockTabs = [
    { id: 'home', name: 'Home', path: 'wisp://home', type: 'folder' as const },
    { id: 'docs', name: 'Documents', path: 'C:\\Users\\Test\\Documents', type: 'folder' as const },
  ];

  const mockProps = {
    leftSidebarCollapsed: false,
    setLeftSidebarCollapsed: vi.fn(),
    currentPath: 'C:\\Users\\Test',
    navigateUp: vi.fn(),
    refetch: vi.fn(),
    navigateBackInHistory: vi.fn(),
    navigateForwardInHistory: vi.fn(),
    canNavigateBackInHistory: vi.fn(() => true),
    canNavigateForwardInHistory: vi.fn(() => false),
    tabs: mockTabs,
    activeTabId: 'home',
    onSwitchTab: vi.fn(),
    onCloseTab: vi.fn(),
    onAddTab: vi.fn(),
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
    it('renders history navigation buttons', () => {
      render(<TopBar {...mockProps} />);
      expect(screen.getByTitle('Go back in history')).toBeInTheDocument();
      expect(screen.getByTitle('Go forward in history')).toBeInTheDocument();
    });

    it('enables/disables history buttons correctly', () => {
      render(<TopBar {...mockProps} />);
      expect(screen.getByTitle('Go back in history')).not.toBeDisabled();
      expect(screen.getByTitle('Go forward in history')).toBeDisabled();
    });

    it('calls navigateBackInHistory when back button is clicked', () => {
      render(<TopBar {...mockProps} />);
      fireEvent.click(screen.getByTitle('Go back in history'));
      expect(mockProps.navigateBackInHistory).toHaveBeenCalled();
    });

    it('renders up and refresh buttons', () => {
      render(<TopBar {...mockProps} />);
      expect(screen.getByTitle('Go up one level')).toBeInTheDocument();
      expect(screen.getByTitle('Refresh')).toBeInTheDocument();
    });

    it('disables up button when at root', () => {
      const rootProps = { ...mockProps, currentPath: 'C:\\' };
      render(<TopBar {...rootProps} />);
      expect(screen.getByTitle('Go up one level')).toBeDisabled();
    });
  });

  describe('Tabs', () => {
    it('renders all tabs', () => {
      render(<TopBar {...mockProps} />);
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getByText('Documents')).toBeInTheDocument();
    });

    it('calls onSwitchTab when tab is clicked', () => {
      render(<TopBar {...mockProps} />);
      fireEvent.click(screen.getByText('Documents'));
      expect(mockProps.onSwitchTab).toHaveBeenCalledWith('docs');
    });

    it('shows close buttons when multiple tabs exist', () => {
      render(<TopBar {...mockProps} />);
      expect(screen.getByRole('button', { name: 'Close Documents' })).toBeInTheDocument();
    });

    it('calls onCloseTab when close button is clicked', () => {
      render(<TopBar {...mockProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Close Documents' }));
      expect(mockProps.onCloseTab).toHaveBeenCalledWith('docs');
    });
  });

  describe('Split/Tab Controls', () => {
    it('calls onAddTab when new tab button is clicked', () => {
      render(<TopBar {...mockProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'New tab' }));
      expect(mockProps.onAddTab).toHaveBeenCalled();
    });

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
        currentPath: 'C:\\',
      };
      expect(() => render(<TopBar {...minimalProps} />)).not.toThrow();
    });
  });
});
