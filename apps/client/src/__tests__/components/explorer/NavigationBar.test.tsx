import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { TauriAPI } from '@/lib/tauri-api';
import '@testing-library/jest-dom';
import NavigationBar from '@/components/explorer/NavigationBar';

// Mock lucide-react icons - use non-conflicting text in icon mocks
vi.mock('lucide-react', () => ({
  ChevronRight: () => <span data-testid="chevron-right">&gt;</span>,
  ChevronUp: () => <span data-testid="chevron-up" />,
  RefreshCw: () => <span data-testid="refresh-icon" />,
  Pencil: () => <span data-testid="pencil-icon" />,
  MoreHorizontal: () => <span />,
  HardDrive: () => <span data-testid="hard-drive-icon" />,
  Home: () => <span data-testid="home-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
  Cloud: () => <span data-testid="cloud-icon" />,
  Folder: () => <span data-testid="folder-icon" />,
}));

vi.mock('@/lib/constants', () => ({
  PATH_SEPARATOR: '\\',
  isWindows: true,
}));

vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    getUserDirectories: vi.fn(() => Promise.resolve({ home: 'C:\\Users\\Test' })),
    readDirectory: vi.fn(() => Promise.resolve([])),
    getFileProperties: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock('@/lib/collections', () => ({
  getCollection: vi.fn(() => null),
}));

describe('NavigationBar', () => {
  const mockNavigateToPath = vi.fn();
  const mockRefetch = vi.fn();

  const defaultProps = {
    currentPath: 'C:\\Users\\Test\\Documents',
    navigateToPath: mockNavigateToPath,
    refetch: mockRefetch,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Per-pane navigation buttons', () => {
    it('renders back/forward/up/refresh and disables them per history state', () => {
      render(
        <NavigationBar
          {...defaultProps}
          onNavigateBack={vi.fn()}
          canNavigateBack={true}
          onNavigateForward={vi.fn()}
          canNavigateForward={false}
          onNavigateUp={vi.fn()}
          canNavigateUp={true}
        />,
      );

      expect(screen.getByTitle('Go back in history')).toBeEnabled();
      expect(screen.getByTitle('Go forward in history')).toBeDisabled();
      expect(screen.getByTitle('Go up one level')).toBeEnabled();
      expect(screen.getByTitle('Refresh')).toBeInTheDocument();
    });

    it('calls the pane-scoped back handler', () => {
      const onNavigateBack = vi.fn();
      render(<NavigationBar {...defaultProps} onNavigateBack={onNavigateBack} canNavigateBack />);

      fireEvent.click(screen.getByTitle('Go back in history'));
      expect(onNavigateBack).toHaveBeenCalledTimes(1);
    });

    it('hides the whole cluster when no handlers are provided', () => {
      render(<NavigationBar {...defaultProps} refetch={undefined} />);
      expect(screen.queryByTitle('Go back in history')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Refresh')).not.toBeInTheDocument();
    });
  });

  describe('Breadcrumb rendering', () => {
    it('renders breadcrumb segments for a Windows path', () => {
      render(<NavigationBar {...defaultProps} />);

      for (const name of ['C:', 'Users', 'Test', 'Documents']) {
        expect(screen.getByRole('button', { name: `Navigate to ${name}` })).toBeInTheDocument();
      }
    });

    it('renders chevron separators between segments', () => {
      render(<NavigationBar {...defaultProps} />);

      const chevrons = screen
        .getAllByTestId('chevron-right')
        .filter((node) => !node.closest('[inert]'));
      // Between 4 segments there should be 3 separators
      expect(chevrons).toHaveLength(3);
    });

    it('omits the redundant edit path button', () => {
      render(<NavigationBar {...defaultProps} />);
      expect(screen.queryByLabelText('Edit path')).not.toBeInTheDocument();
    });

    it('last segment has current location aria attribute', () => {
      render(<NavigationBar {...defaultProps} />);
      const lastSegment = screen.getByRole('button', { name: 'Navigate to Documents' });
      expect(lastSegment.closest('button')).toHaveAttribute('aria-current', 'location');
    });
  });

  describe('Special paths', () => {
    it('displays "Home" label for wisp://home', () => {
      render(<NavigationBar {...defaultProps} currentPath="wisp://home" />);
      expect(screen.getByText('Home')).toBeInTheDocument();
    });

    it('displays "Trash" label for wisp://trash', () => {
      render(<NavigationBar {...defaultProps} currentPath="wisp://trash" />);
      expect(screen.getByText('Trash')).toBeInTheDocument();
    });

    it('displays "Google Drive" label for wisp://gdrive-manager', () => {
      render(<NavigationBar {...defaultProps} currentPath="wisp://gdrive-manager" />);
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });
  });

  describe('Breadcrumb navigation', () => {
    it('calls navigateToPath when clicking a breadcrumb segment', () => {
      render(<NavigationBar {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: 'Navigate to Users' }));
      expect(mockNavigateToPath).toHaveBeenCalledWith(expect.stringContaining('Users'));
    });

    it('navigates to root drive when clicking drive segment', () => {
      render(<NavigationBar {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: 'Navigate to C:' }));
      expect(mockNavigateToPath).toHaveBeenCalledWith(expect.stringContaining('C:'));
    });
  });

  describe('responsive toolbar paths', () => {
    const paneWidths = new Map<string, number>();
    const observers: Array<{ callback: () => void; targets: Set<Element> }> = [];
    const restoreMeasurements: Array<() => void> = [];

    beforeEach(() => {
      paneWidths.clear();
      paneWidths.set('left', 500);
      paneWidths.set('right', 500);
      observers.length = 0;
      const clientWidth = vi
        .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
        .mockImplementation(function () {
          if (!this.classList.contains('wisp-breadcrumb-trail')) return 0;
          const pane = this.closest<HTMLElement>('[data-test-pane]');
          return paneWidths.get(pane?.dataset.testPane ?? 'left') ?? 0;
        });
      const boundingRect = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(function () {
          const width = this.classList.contains('wisp-editor-pane')
            ? (paneWidths.get(this.dataset.testPane ?? 'left') ?? 0)
            : 64;
          return {
            width,
            height: 28,
            x: 0,
            y: 0,
            top: 0,
            bottom: 28,
            left: 0,
            right: width,
            toJSON: () => ({}),
          };
        });
      restoreMeasurements.push(
        () => clientWidth.mockRestore(),
        () => boundingRect.mockRestore(),
      );
      vi.stubGlobal(
        'ResizeObserver',
        class {
          record: (typeof observers)[number];

          constructor(callback: () => void) {
            this.record = { callback, targets: new Set() };
            observers.push(this.record);
          }

          observe(target: Element) {
            this.record.targets.add(target);
          }

          disconnect() {
            this.record.targets.clear();
          }
        },
      );
    });

    afterEach(() => {
      for (const restore of restoreMeasurements.splice(0)) restore();
      vi.unstubAllGlobals();
    });

    const resizePane = (pane: string, width: number) => {
      act(() => {
        paneWidths.set(pane, width);
        for (const observer of observers) {
          if (
            [...observer.targets].some(
              (target) =>
                target.closest<HTMLElement>('[data-test-pane]')?.dataset.testPane === pane,
            )
          ) {
            observer.callback();
          }
        }
      });
    };

    it.each([
      [601, true, true],
      [600, true, false],
      [360, true, false],
      [360, false, true],
    ])(
      'retains back and forward while navigation extras adapt at %ipx (overflow enabled: %s)',
      (width, compactActionsInMenu, extrasVisible) => {
        paneWidths.set('left', width);
        const onNavigateBack = vi.fn();
        const onNavigateForward = vi.fn();
        const onNavigateUp = vi.fn();
        render(
          <section className="wisp-editor-pane" data-test-pane="left">
            <NavigationBar
              {...defaultProps}
              compactActionsInMenu={compactActionsInMenu}
              onNavigateBack={onNavigateBack}
              onNavigateForward={onNavigateForward}
              canNavigateBack
              canNavigateForward
              onNavigateUp={onNavigateUp}
              canNavigateUp
            />
          </section>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Go back in history' }));
        fireEvent.click(screen.getByRole('button', { name: 'Go forward in history' }));
        expect(onNavigateBack).toHaveBeenCalledOnce();
        expect(onNavigateForward).toHaveBeenCalledOnce();
        if (extrasVisible) {
          fireEvent.click(screen.getByRole('button', { name: 'Go up one level' }));
          fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
          expect(onNavigateUp).toHaveBeenCalledOnce();
          expect(mockRefetch).toHaveBeenCalledOnce();
        } else {
          expect(screen.queryByRole('button', { name: 'Go up one level' })).not.toBeInTheDocument();
          expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
          expect(onNavigateUp).not.toHaveBeenCalled();
          expect(mockRefetch).not.toHaveBeenCalled();
        }
      },
    );

    it('collapses each pane path independently and restores parents when the pane grows', () => {
      render(
        <>
          <section aria-label="Left pane" data-test-pane="left">
            <NavigationBar {...defaultProps} />
          </section>
          <section aria-label="Right pane" data-test-pane="right">
            <NavigationBar {...defaultProps} />
          </section>
        </>,
      );
      const left = within(screen.getByRole('region', { name: 'Left pane' }));
      const right = within(screen.getByRole('region', { name: 'Right pane' }));

      resizePane('left', 140);

      expect(left.queryByRole('button', { name: 'Navigate to Users' })).not.toBeInTheDocument();
      expect(left.getByRole('button', { name: 'Navigate to Documents' })).toHaveAttribute(
        'aria-current',
        'location',
      );
      expect(right.getByRole('button', { name: 'Navigate to Users' })).toBeInTheDocument();
      expect(right.queryByRole('button', { name: 'Show parent folders' })).not.toBeInTheDocument();

      resizePane('left', 500);

      expect(left.getByRole('button', { name: 'Navigate to Users' })).toBeInTheDocument();
      expect(left.queryByRole('button', { name: 'Show parent folders' })).not.toBeInTheDocument();
    });

    it('keeps hidden parent folders navigable without entering path editing', () => {
      paneWidths.set('left', 140);
      render(
        <section data-test-pane="left">
          <NavigationBar {...defaultProps} />
        </section>,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show parent folders' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Users' }));

      expect(mockNavigateToPath).toHaveBeenCalledWith('C:\\Users\\');
      expect(screen.queryByLabelText('File path')).not.toBeInTheDocument();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('opens the full editable path from a collapsed trail and still submits it', async () => {
      paneWidths.set('left', 140);
      render(
        <section data-test-pane="left">
          <NavigationBar {...defaultProps} />
        </section>,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Show parent folders' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Show full path' }));

      const input = screen.getByLabelText('File path');
      expect(input).toHaveValue(defaultProps.currentPath);
      expect(input).toHaveFocus();
      expect(mockNavigateToPath).not.toHaveBeenCalled();
      fireEvent.change(input, { target: { value: 'C:\\OtherFolder' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => expect(mockNavigateToPath).toHaveBeenCalledWith('C:\\OtherFolder'));
    });
  });

  describe('Path editing mode', () => {
    it('keeps the address field box stable between breadcrumb and input modes', () => {
      const { container } = render(<NavigationBar {...defaultProps} />);
      const addressField = container.querySelector('.wisp-address-field');

      expect(addressField).toBeInTheDocument();
      fireEvent.click(screen.getByRole('navigation', { name: 'Breadcrumb' }));

      expect(container.querySelector('.wisp-address-field')).toBe(addressField);
      expect(screen.getByLabelText('File path')).toHaveClass('wisp-address-input');
    });

    it('enters editing mode when clicking the address trail background', () => {
      render(<NavigationBar {...defaultProps} />);

      fireEvent.click(screen.getByRole('navigation', { name: 'Breadcrumb' }));

      const input = screen.getByLabelText('File path');
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue('C:\\Users\\Test\\Documents');
    });

    it('shows placeholder text in edit mode', () => {
      render(<NavigationBar {...defaultProps} />);

      fireEvent.click(screen.getByRole('navigation', { name: 'Breadcrumb' }));

      expect(screen.getByPlaceholderText('Enter a path or website...')).toBeInTheDocument();
    });

    it('cancels editing on Escape', () => {
      render(<NavigationBar {...defaultProps} />);

      fireEvent.click(screen.getByRole('navigation', { name: 'Breadcrumb' }));
      const input = screen.getByLabelText('File path');

      fireEvent.keyDown(input, { key: 'Escape' });

      // Should return to breadcrumb mode
      expect(screen.queryByLabelText('File path')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Navigate to Documents' })).toBeInTheDocument();
    });

    it('submits path on Enter', async () => {
      render(<NavigationBar {...defaultProps} />);

      fireEvent.click(screen.getByRole('navigation', { name: 'Breadcrumb' }));
      const input = screen.getByLabelText('File path');

      fireEvent.change(input, { target: { value: 'C:\\NewPath' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      // handleSubmit is async (expandTilde), so wait for navigation
      await waitFor(() => {
        expect(mockNavigateToPath).toHaveBeenCalledWith('C:\\NewPath');
      });
    });

    it('does not navigate when submitting same path', () => {
      render(<NavigationBar {...defaultProps} />);

      fireEvent.click(screen.getByRole('navigation', { name: 'Breadcrumb' }));
      const input = screen.getByLabelText('File path');

      // Submit without changing the value
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(mockNavigateToPath).not.toHaveBeenCalled();
    });

    it('has correct ARIA attributes for autocomplete', () => {
      render(<NavigationBar {...defaultProps} />);

      fireEvent.click(screen.getByRole('navigation', { name: 'Breadcrumb' }));
      const input = screen.getByLabelText('File path');

      expect(input).toHaveAttribute('aria-autocomplete', 'list');
      expect(input).toHaveAttribute('spellcheck', 'false');
    });
  });

  describe('website input', () => {
    it.each([
      ['github.com', 'https://github.com/'],
      ['localhost:5190/?demo=1', 'http://localhost:5190/?demo=1'],
      ['https://example.com/path', 'https://example.com/path'],
      ['~/Documents', 'C:\\Users\\Test/Documents'],
      ['report.pdf', 'report.pdf'],
    ])('submits %s as %s', async (value, expected) => {
      render(<NavigationBar {...defaultProps} />);
      fireEvent.click(screen.getByRole('navigation', { name: 'Breadcrumb' }));
      const input = screen.getByLabelText('File path');
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() => expect(mockNavigateToPath).toHaveBeenCalledWith(expected));
    });

    it('gives an existing local folder priority over an implicit website', async () => {
      vi.mocked(TauriAPI.getFileProperties).mockResolvedValueOnce({ is_dir: true } as never);
      render(<NavigationBar {...defaultProps} />);
      fireEvent.click(screen.getByRole('navigation', { name: 'Breadcrumb' }));
      const input = screen.getByLabelText('File path');
      fireEvent.change(input, { target: { value: 'github.com' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() =>
        expect(mockNavigateToPath).toHaveBeenCalledWith('C:\\Users\\Test\\Documents\\github.com'),
      );
    });

    it('does not validate a website as a file path or open it on blur', async () => {
      vi.useFakeTimers();
      try {
        render(<NavigationBar {...defaultProps} />);
        fireEvent.click(screen.getByRole('navigation', { name: 'Breadcrumb' }));
        const input = screen.getByLabelText('File path');
        fireEvent.change(input, { target: { value: 'github.com/xiixiixixi/wisp' } });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(350);
        });
        expect(TauriAPI.readDirectory).not.toHaveBeenCalled();
        expect(TauriAPI.getFileProperties).not.toHaveBeenCalled();
        input.blur();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(200);
        });
        expect(mockNavigateToPath).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores stale folder suggestions and validation after switching to a URL', async () => {
      let resolveEntries!: (entries: never) => void;
      let resolveProperties!: (properties: never) => void;
      vi.mocked(TauriAPI.readDirectory).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveEntries = resolve;
        }),
      );
      vi.mocked(TauriAPI.getFileProperties).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveProperties = resolve;
        }),
      );
      render(<NavigationBar {...defaultProps} />);
      fireEvent.click(screen.getByRole('navigation', { name: 'Breadcrumb' }));
      const input = screen.getByLabelText('File path');
      fireEvent.change(input, { target: { value: '/old/folder/' } });
      await waitFor(() => expect(TauriAPI.getFileProperties).toHaveBeenCalled());
      fireEvent.change(input, { target: { value: 'github.com' } });
      await act(async () => {
        resolveEntries([{ name: 'stale', path: '/old/folder/stale', is_dir: true }] as never);
        resolveProperties({ is_dir: true } as never);
      });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Path exists')).not.toBeInTheDocument();
      fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
      expect(mockNavigateToPath).not.toHaveBeenCalled();
      fireEvent.keyDown(input, { key: 'Escape' });
    });
  });

  describe('Drive letter display', () => {
    it('shows hard drive icon for root drive segment', () => {
      render(<NavigationBar {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Navigate to C:' })).toContainElement(
        screen.getAllByTestId('hard-drive-icon').find((node) => !node.closest('[inert]'))!,
      );
    });
  });

  describe('Empty path', () => {
    it('handles empty path without crashing', () => {
      render(<NavigationBar {...defaultProps} currentPath="" />);
      // Should render the container without breadcrumbs
      const { container } = render(<NavigationBar {...defaultProps} currentPath="" />);
      expect(container).toBeInTheDocument();
    });
  });
});
