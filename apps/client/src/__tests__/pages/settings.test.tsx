import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock wouter (already mocked globally, but we override for fine-grained control)
const mockSetLocation = vi.fn();
vi.mock('wouter', async () => {
  const React = await import('react');
  return {
    useLocation: vi.fn(() => ['/settings', mockSetLocation]),
    Route: ({ children }: { children: React.ReactNode }) => children,
    Link: ({ children, href, ...props }: { children: React.ReactNode; href: string }) =>
      React.createElement('a', { href, ...props }, children),
  };
});

vi.mock('@/lib/transport', () => ({
  isTauri: () => false,
}));

// Shared mock prop types for Radix UI
type MockProps = Record<string, unknown> & { children?: React.ReactNode };
type MockRef = React.Ref<HTMLElement>;

// Mock the radix-ui select for language and file-view controls.
vi.mock('@radix-ui/react-select', async () => {
  const React = await import('react');
  return {
    Root: ({ children, value }: MockProps) =>
      React.createElement('div', { 'data-testid': `select-root-${value}` }, children),
    Trigger: React.forwardRef(({ children, className, ...props }: MockProps, ref: MockRef) =>
      React.createElement('button', { ...props, ref, className }, children),
    ),
    Value: ({ children, placeholder }: MockProps) =>
      React.createElement('span', {}, children || (placeholder as string)),
    Content: ({ children }: MockProps) => React.createElement('div', {}, children),
    Item: React.forwardRef(({ children, value, ...props }: MockProps, ref: MockRef) =>
      React.createElement(
        'div',
        { ...props, ref, role: 'option', 'data-value': value as string },
        children,
      ),
    ),
    Icon: ({ children }: MockProps) => React.createElement('span', {}, children),
    Viewport: ({ children }: MockProps) => React.createElement('div', {}, children),
    ItemIndicator: ({ children }: MockProps) => React.createElement('span', {}, children),
    ItemText: ({ children }: MockProps) => React.createElement('span', {}, children),
    ScrollUpButton: React.forwardRef((props: MockProps, ref: MockRef) =>
      React.createElement('button', { ...props, ref }),
    ),
    ScrollDownButton: React.forwardRef((props: MockProps, ref: MockRef) =>
      React.createElement('button', { ...props, ref }),
    ),
    Portal: ({ children }: MockProps) => children,
    Group: ({ children }: MockProps) => React.createElement('div', {}, children),
    Label: ({ children }: MockProps) => React.createElement('span', {}, children),
    Separator: () => React.createElement('hr'),
  };
});

// Mock theme-registry — Wisp ships exactly three built-in themes
vi.mock('@/lib/theme-registry', () => ({
  useAllThemes: vi.fn(() => ({
    rolex: {
      name: 'Wisp Ink',
      primary: '#79a8d8',
      bg: '#11161d',
      surface: '#171d25',
      text: '#e6ebf1',
    },
    glass: {
      name: 'Wisp Slate',
      primary: '#8aa8c8',
      bg: '#242a32',
      surface: '#2b323b',
      text: '#edf0f3',
    },
    light: {
      name: 'Wisp Paper',
      primary: '#4f759b',
      bg: '#f1f3f5',
      surface: '#e8ecf0',
      text: '#26313b',
    },
  })),
}));

// Mock agent-service
vi.mock('@/lib/agent-service', () => ({
  AgentService: {
    getSettings: vi.fn(() =>
      Promise.resolve({
        enabled: true,
        api_key: '',
        openai_api_key: '',
        model: 'claude-sonnet-4-6',
        max_turns: 25,
        auto_approve: false,
        thinking_enabled: false,
        thinking_budget: 10000,
      }),
    ),
    updateSettings: vi.fn(() => Promise.resolve()),
    getPermissions: vi.fn(() =>
      Promise.resolve({
        disabled_tools: [],
        auto_approve_tools: [],
        allowed_paths: [],
        blocked_paths: [],
        custom_blocked_commands: [],
        block_internet: true,
      }),
    ),
    updatePermissions: vi.fn(() => Promise.resolve()),
  },
}));

// Mock vim-mode hooks
vi.mock('@/hooks/use-vim-mode', () => ({
  isVimModeEnabled: vi.fn(() => false),
  setVimModeSetting: vi.fn(),
  isVimLearningModeEnabled: vi.fn(() => false),
  setVimLearningModeSetting: vi.fn(),
}));

// Mock heavy sub-components that are not the focus of this test
vi.mock('@/components/KeyboardShortcutsSettings', () => ({
  default: () => <div data-testid="keyboard-shortcuts-settings">Keyboard Shortcuts Settings</div>,
}));

vi.mock('@/components/settings/ContextMenuRulesCard', () => ({
  default: () => <div data-testid="context-menu-rules">Context Menu Rules</div>,
}));

import Settings from '@/pages/settings';

/** Helper to click a sidebar tab by label text */
const clickSidebarTab = (label: string) => {
  // The sidebar is inside a <nav> element
  const nav = document.querySelector('nav')!;
  const navSection = within(nav);
  const tabButton = navSection.getByText(label).closest('button')!;
  fireEvent.click(tabButton);
};

describe('Settings Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('Page Layout', () => {
    it('renders the Settings heading', async () => {
      render(<Settings />);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings');
      });
    });

    it('renders the subtitle text', async () => {
      render(<Settings />);

      await waitFor(() => {
        expect(screen.getByText('Customize your Wisp experience')).toBeInTheDocument();
      });
    });

    it('renders a back button with title', async () => {
      render(<Settings />);

      await waitFor(() => {
        const backBtn = screen.getByTitle('Back to Home');
        expect(backBtn).toBeInTheDocument();
      });
    });

    it('links the back button to home', async () => {
      render(<Settings />);

      await waitFor(() => {
        const backBtn = screen.getByTitle('Back to Home');
        expect(backBtn.closest('a')).toHaveAttribute('href', '/');
      });
    });

    it('defaults the language control to Chinese', async () => {
      render(<Settings />);

      await waitFor(() => {
        expect(screen.getByTestId('select-root-zh')).toBeInTheDocument();
      });
    });

    it('normalizes a previously stored zh-CN language value', async () => {
      localStorage.setItem('wisp:settings', JSON.stringify({ language: 'zh-CN' }));

      render(<Settings />);

      await waitFor(() => {
        expect(screen.getByTestId('select-root-zh')).toBeInTheDocument();
      });
    });
  });

  describe('Navigation Sidebar', () => {
    it('renders all settings tabs in the sidebar', async () => {
      render(<Settings />);

      const nav = document.querySelector('nav')!;
      const navSection = within(nav);

      await waitFor(() => {
        expect(navSection.getByText('General')).toBeInTheDocument();
        expect(navSection.getByText('File Explorer')).toBeInTheDocument();
        expect(navSection.queryByText('Context Menu')).not.toBeInTheDocument();
        expect(navSection.queryByText('AI Agent')).not.toBeInTheDocument();
        expect(navSection.queryByText('Permissions')).not.toBeInTheDocument();
        expect(navSection.getByText('Shortcuts')).toBeInTheDocument();
        expect(navSection.queryByText('Marketplace')).not.toBeInTheDocument();
        expect(navSection.queryByText('Accessibility')).not.toBeInTheDocument();
        expect(navSection.getAllByRole('button')).toHaveLength(4);
        expect(navSection.queryByText('Backup & Restore')).not.toBeInTheDocument();
        expect(navSection.queryByText('Audit Log')).not.toBeInTheDocument();
        expect(navSection.queryByText('Versioning')).not.toBeInTheDocument();
        expect(navSection.getByText('About')).toBeInTheDocument();
      });
    });

    it('shows tab descriptions in the sidebar', async () => {
      render(<Settings />);

      const nav = document.querySelector('nav')!;
      const navSection = within(nav);

      await waitFor(() => {
        expect(navSection.getByText('Language & app preferences')).toBeInTheDocument();
        expect(navSection.getByText('Display & file actions')).toBeInTheDocument();
        expect(navSection.queryByText('AI provider settings')).not.toBeInTheDocument();
      });
    });

    it('defaults to General tab as active', async () => {
      render(<Settings />);

      // The main content heading for the active tab
      const mainContent = document.querySelector('main')!;
      const mainSection = within(mainContent);

      await waitFor(() => {
        expect(mainSection.getByRole('heading', { level: 2 })).toHaveTextContent('General');
      });
    });
  });

  describe('Tab Navigation', () => {
    it('switches to File Explorer tab when clicked', async () => {
      render(<Settings />);

      await waitFor(() => {
        expect(document.querySelector('nav')).toBeInTheDocument();
      });

      clickSidebarTab('File Explorer');

      const mainContent = document.querySelector('main')!;
      const mainSection = within(mainContent);

      await waitFor(() => {
        expect(mainSection.getByText('Default View')).toBeInTheDocument();
        expect(mainSection.queryByText('Show Hidden Files')).not.toBeInTheDocument();
      });
    });

    it('removes the Accessibility category entirely', () => {
      render(<Settings />);
      expect(
        within(document.querySelector('nav')!).queryByText('Accessibility'),
      ).not.toBeInTheDocument();
    });

    it('switches to Shortcuts tab when clicked', async () => {
      render(<Settings />);

      await waitFor(() => {
        expect(document.querySelector('nav')).toBeInTheDocument();
      });

      clickSidebarTab('Shortcuts');

      await waitFor(() => {
        expect(screen.getByText('Vim Mode')).toBeInTheDocument();
        expect(screen.getByTestId('keyboard-shortcuts-settings')).toBeInTheDocument();
      });
    });

    it.each([null, 'false', 'true'])('does not change extension update policy (%s)', (saved) => {
      if (saved !== null) localStorage.setItem('wisp:auto-update-extensions', saved);
      render(<Settings />);
      expect(localStorage.getItem('wisp:auto-update-extensions')).toBe(saved);
      expect(screen.queryByText('Auto-update extensions')).not.toBeInTheDocument();
    });

    it('puts context menu rules in a closed explorer disclosure', () => {
      render(<Settings />);
      clickSidebarTab('File Explorer');
      const summary = screen.getByText('Context Menu', { selector: 'summary' });
      expect(summary.closest('details')).not.toHaveAttribute('open');
      expect(
        within(document.querySelector('nav')!).queryByText('Context Menu'),
      ).not.toBeInTheDocument();
    });

    it('keeps About reachable after removing the versioning category', async () => {
      render(<Settings />);

      await waitFor(() => {
        expect(document.querySelector('nav')).toBeInTheDocument();
      });

      clickSidebarTab('About');

      await waitFor(() => {
        expect(
          within(document.querySelector('main')!).getByRole('heading', { name: 'About' }),
        ).toBeInTheDocument();
      });
    });
  });

  describe('General Tab - Settings Controls', () => {
    it('only shows language and reset on non-Windows platforms', () => {
      render(<Settings />);
      const main = within(document.querySelector('main')!);
      expect(main.getByText('Language')).toBeInTheDocument();
      expect(main.getByText('Reset all settings to defaults')).toBeInTheDocument();
      for (const label of [
        'Font Size',
        'Animations',
        'Sidebar Width',
        'Notifications',
        'Auto Save',
        'Fluid Glass',
        'Show weather',
        'Weather city',
        'System Integration',
        'Onboarding Tour',
      ]) {
        expect(main.queryByText(label)).not.toBeInTheDocument();
      }
    });
  });

  describe('Retained setting interactions', () => {
    it('persists file-extension display changes', async () => {
      render(<Settings />);
      clickSidebarTab('File Explorer');
      fireEvent.click(screen.getByRole('switch', { name: 'File Extensions' }));
      await waitFor(() =>
        expect(JSON.parse(localStorage.getItem('wisp:settings')!).showFileExtensions).toBe(false),
      );
    });
  });

  describe('File Explorer Tab', () => {
    it('renders file explorer settings when that tab is active', async () => {
      render(<Settings />);

      await waitFor(() => {
        expect(document.querySelector('nav')).toBeInTheDocument();
      });

      clickSidebarTab('File Explorer');

      const mainContent = document.querySelector('main')!;
      const mainSection = within(mainContent);

      await waitFor(() => {
        expect(mainSection.getByText('Default View')).toBeInTheDocument();
        expect(mainSection.queryByText('Show Hidden Files')).not.toBeInTheDocument();
        expect(mainSection.getByText('File Extensions')).toBeInTheDocument();
        expect(mainSection.getByText('Auto-Calculate Folder Sizes')).toBeInTheDocument();
        expect(mainSection.queryByText('Markdown Preview')).not.toBeInTheDocument();
      });
    });

    it('does not duplicate the title bar hidden-files toggle', async () => {
      render(<Settings />);

      await waitFor(() => {
        expect(document.querySelector('nav')).toBeInTheDocument();
      });

      clickSidebarTab('File Explorer');

      await waitFor(() => {
        expect(screen.getByText('Default View')).toBeInTheDocument();
        expect(document.getElementById('hiddenFiles')).not.toBeInTheDocument();
      });
    });
  });

  describe('File opening preferences', () => {
    it('keeps file associations in the explorer, collapsed by default', () => {
      render(<Settings />);
      clickSidebarTab('File Explorer');
      const summary = screen.getByText('File Associations', { selector: 'summary' });
      expect(summary.closest('details')).not.toHaveAttribute('open');
      expect(
        within(document.querySelector('nav')!).queryByText('File Associations'),
      ).not.toBeInTheDocument();
    });
  });

  describe('LocalStorage Persistence', () => {
    it('migrates removed controls while preserving real preferences', async () => {
      localStorage.setItem(
        'wisp:settings',
        JSON.stringify({
          language: 'en',
          defaultView: 'list',
          showHiddenFiles: true,
          fontSize: 'large',
          fluidGlass: false,
          enableAnimations: false,
          highContrast: true,
        }),
      );
      render(<Settings />);
      await waitFor(() => {
        const saved = JSON.parse(localStorage.getItem('wisp:settings')!);
        expect(saved).toMatchObject({ language: 'en', defaultView: 'list', showHiddenFiles: true });
        for (const key of ['fontSize', 'fluidGlass', 'enableAnimations', 'highContrast']) {
          expect(saved).not.toHaveProperty(key);
        }
      });
    });
  });
});
