import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import OperationBar from '@/components/explorer/OperationBar';
import type { SortField } from '@/lib/utils';

const { openAirDrop, isTauri, toast } = vi.hoisted(() => ({
  openAirDrop: vi.fn<(paths: string[]) => Promise<void>>(),
  isTauri: vi.fn(() => true),
  toast: vi.fn(),
}));

vi.mock('@/lib/tauri-api/airdrop', () => ({ openAirDrop }));
vi.mock('@/lib/transport', () => ({ isTauri }));
vi.mock('@/hooks/use-toast', () => ({ toast }));

describe('OperationBar', () => {
  const mockViewModes: Record<string, { id: string; name: string; icon: ReactNode }> = {
    small: { id: 'small', name: 'Small Icons', icon: 'small' },
    medium: { id: 'medium', name: 'Medium Icons', icon: 'medium' },
    large: { id: 'large', name: 'Large Icons', icon: 'large' },
    list: { id: 'list', name: 'List View', icon: 'list' },
    details: { id: 'details', name: 'Details View', icon: 'details' },
  };

  const mockSortOptions: Record<SortField, { id: SortField; name: string; icon: ReactNode }> = {
    name: { id: 'name', name: 'Name', icon: 'name' },
    dateModified: { id: 'dateModified', name: 'Date Modified', icon: 'modified' },
    dateCreated: { id: 'dateCreated', name: 'Date Created', icon: 'created' },
    size: { id: 'size', name: 'Size', icon: 'size' },
    type: { id: 'type', name: 'Type', icon: 'type' },
    extension: { id: 'extension', name: 'Extension', icon: 'extension' },
  };

  const mockProps = {
    viewMode: 'medium',
    setViewMode: vi.fn(),
    viewModes: mockViewModes,
    sortBy: 'name' as SortField,
    setSortBy: vi.fn(),
    sortOrder: 'asc' as const,
    toggleSortOrder: vi.fn(),
    sortOptions: mockSortOptions,
    handleCreateFolder: vi.fn(),
    handleDelete: vi.fn(),
    selectedFiles: new Set<string>(),
    setBottomPanelCollapsed: vi.fn(),
    setBottomPanelTab: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    openAirDrop.mockReset().mockResolvedValue(undefined);
    isTauri.mockReturnValue(true);
  });

  it('shows the localized current sort and view labels', () => {
    render(<OperationBar {...mockProps} />);

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Medium Icons')).toBeInTheDocument();
  });

  it('runs the primary folder and terminal actions', () => {
    render(<OperationBar {...mockProps} />);

    fireEvent.click(screen.getByTitle('Create folder'));
    fireEvent.click(screen.getByTitle('Open terminal'));

    expect(mockProps.handleCreateFolder).toHaveBeenCalledTimes(1);
    expect(mockProps.setBottomPanelCollapsed).toHaveBeenCalledWith(false);
    expect(mockProps.setBottomPanelTab).toHaveBeenCalledWith('terminal');
  });

  describe('AirDrop', () => {
    it('opens AirDrop with an empty selection instead of sending the current directory', async () => {
      const user = userEvent.setup();
      render(<OperationBar {...mockProps} currentPath="/Users/test/Documents" />);

      await user.click(screen.getByRole('button', { name: 'AirDrop', exact: true }));

      expect(openAirDrop).toHaveBeenCalledTimes(1);
      expect(openAirDrop).toHaveBeenCalledWith([]);
      expect(toast).not.toHaveBeenCalled();
    });

    it('passes the current selected file and directory paths to the native sheet', async () => {
      const user = userEvent.setup();
      const selection = new Set([
        '/Users/test/Documents/notes.txt',
        '/Users/test/Documents/Project',
      ]);
      render(<OperationBar {...mockProps} selectedFiles={selection} />);

      await user.click(screen.getByRole('button', { name: 'AirDrop', exact: true }));

      expect(openAirDrop).toHaveBeenCalledTimes(1);
      expect(openAirDrop).toHaveBeenCalledWith([...selection]);
      expect(toast).not.toHaveBeenCalled();
    });

    it('shows a desktop availability message in the browser without calling the native API', async () => {
      isTauri.mockReturnValue(false);
      const user = userEvent.setup();
      render(<OperationBar {...mockProps} selectedFiles={new Set(['/demo/notes.txt'])} />);

      await user.click(screen.getByRole('button', { name: 'AirDrop', exact: true }));

      expect(openAirDrop).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(toast.mock.calls[0][0])).toMatch(/desktop|macOS/i);
      expect(screen.getByRole('button', { name: 'AirDrop', exact: true })).toBeEnabled();
    });

    it('prevents duplicate launches while pending and restores the button without a transfer success claim', async () => {
      let finish!: () => void;
      openAirDrop.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const user = userEvent.setup();
      render(<OperationBar {...mockProps} />);
      const button = screen.getByRole('button', { name: 'AirDrop', exact: true });

      await user.click(button);
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
      await user.click(button);
      expect(openAirDrop).toHaveBeenCalledTimes(1);

      await act(async () => finish());
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('aria-busy', 'true');
      expect(toast).not.toHaveBeenCalled();
    });

    it('reports a native launch failure and allows retry', async () => {
      openAirDrop.mockRejectedValueOnce(new Error('AirDrop service is unavailable'));
      const user = userEvent.setup();
      render(<OperationBar {...mockProps} />);
      const button = screen.getByRole('button', { name: 'AirDrop', exact: true });

      await user.click(button);
      await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          title: 'Could not open AirDrop',
          description: expect.stringContaining('try again'),
        }),
      );
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('aria-busy', 'true');

      await user.click(button);
      expect(openAirDrop).toHaveBeenCalledTimes(2);
      expect(toast).toHaveBeenCalledTimes(1);
    });
  });

  it('changes the sort field from the dropdown', () => {
    render(<OperationBar {...mockProps} />);

    fireEvent.click(screen.getByText('Name'));
    fireEvent.click(screen.getByText('Size'));

    expect(mockProps.setSortBy).toHaveBeenCalledWith('size');
    expect(screen.queryByText('Date Modified')).not.toBeInTheDocument();
  });

  it('toggles sort order when the active field is selected again', () => {
    render(<OperationBar {...mockProps} />);

    fireEvent.click(screen.getByText('Name'));
    fireEvent.click(screen.getAllByText('Name').at(-1)!);

    expect(mockProps.toggleSortOrder).toHaveBeenCalledTimes(1);
  });

  it('changes the view mode from the dropdown', () => {
    render(<OperationBar {...mockProps} />);

    fireEvent.click(screen.getByText('Medium Icons'));
    fireEvent.click(screen.getByText('Large Icons'));

    expect(mockProps.setViewMode).toHaveBeenCalledWith('large');
  });

  it.each(['Enter', ' '])('opens the menu with %s and continues native tab order', async (key) => {
    const user = userEvent.setup();
    const rects = vi
      .spyOn(HTMLElement.prototype, 'getClientRects')
      .mockReturnValue([{}] as unknown as DOMRectList);
    render(<OperationBar {...mockProps} />);
    const sortTrigger = screen.getByRole('button', { name: /Sort by/ });
    const viewTrigger = screen.getByRole('button', { name: /View mode/ });
    sortTrigger.focus();
    await user.keyboard(key === 'Enter' ? '{Enter}' : ' ');
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Name' })).toHaveFocus());
    await user.tab();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(viewTrigger).toHaveFocus();

    await user.keyboard(key === 'Enter' ? '{Enter}' : ' ');
    await waitFor(() =>
      expect(screen.getByRole('menuitemradio', { name: /Small Icons/ })).toHaveFocus(),
    );
    await user.tab({ shift: true });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(sortTrigger).toHaveFocus();
    rects.mockRestore();
  });

  it('activates sort and view options through real pointer interaction', async () => {
    const user = userEvent.setup();
    render(<OperationBar {...mockProps} />);

    await user.click(screen.getByText('Name'));
    await user.click(screen.getByText('Size'));
    expect(mockProps.setSortBy).toHaveBeenCalledWith('size');

    await user.click(screen.getByText('Medium Icons'));
    await user.click(screen.getByText('Large Icons'));
    expect(mockProps.setViewMode).toHaveBeenCalledWith('large');
  });

  it('keeps only one toolbar menu open at a time', async () => {
    const user = userEvent.setup();
    render(<OperationBar {...mockProps} />);

    const sortTrigger = screen.getByRole('button', { name: /Sort by/ });
    const viewTrigger = screen.getByRole('button', { name: /View mode/ });

    await user.click(sortTrigger);
    expect(sortTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Date Modified')).toBeInTheDocument();

    await user.click(viewTrigger);
    expect(sortTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(viewTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText('Date Modified')).not.toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /Large Icons$/ })).toBeInTheDocument();
  });

  it('supports arrow navigation and restores trigger focus on Escape', async () => {
    const user = userEvent.setup();
    render(<OperationBar {...mockProps} />);

    const sortTrigger = screen.getByRole('button', { name: /Sort by/ });
    sortTrigger.focus();
    await user.keyboard('{ArrowDown}');

    const firstOption = screen.getByRole('menuitemradio', { name: 'Name' });
    await vi.waitFor(() => expect(firstOption).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Date Modified' })).toHaveFocus();

    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(sortTrigger).toHaveFocus());
    expect(sortTrigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps selection actions hidden when nothing is selected', () => {
    render(<OperationBar {...mockProps} onCopy={vi.fn()} onCut={vi.fn()} onPreview={vi.fn()} />);

    expect(screen.queryByTitle('Copy')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Cut')).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Delete/)).not.toBeInTheDocument();
    expect(screen.queryByTitle('Preview selected file')).not.toBeInTheDocument();
  });

  it('shows compact file actions for an active selection', () => {
    const onCopy = vi.fn();
    const onCut = vi.fn();
    render(
      <OperationBar
        {...mockProps}
        selectedFiles={new Set(['a.txt', 'b.txt'])}
        onCopy={onCopy}
        onCut={onCut}
      />,
    );

    fireEvent.click(screen.getByTitle('Copy'));
    fireEvent.click(screen.getByTitle('Cut'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 selected item(s)' }));

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCut).toHaveBeenCalledTimes(1);
    expect(mockProps.handleDelete).toHaveBeenCalledTimes(1);
  });

  it('replaces browsing controls with a focused selection toolbar', () => {
    const onSelectNone = vi.fn();
    render(
      <OperationBar
        {...mockProps}
        selectedFiles={new Set(['a.txt'])}
        onSelectNone={onSelectNone}
      />,
    );

    expect(screen.getByRole('toolbar', { name: 'Selected file actions' })).toBeInTheDocument();
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
    expect(screen.queryByText('Medium Icons')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear Selection' })).not.toBeInTheDocument();
  });

  it('offers preview only for a single selected file', () => {
    const onPreview = vi.fn();
    const { rerender } = render(
      <OperationBar {...mockProps} selectedFiles={new Set(['a.txt'])} onPreview={onPreview} />,
    );

    fireEvent.click(screen.getByTitle('Preview selected file'));
    expect(onPreview).toHaveBeenCalledTimes(1);

    rerender(
      <OperationBar
        {...mockProps}
        selectedFiles={new Set(['a.txt', 'b.txt'])}
        onPreview={onPreview}
      />,
    );
    expect(screen.queryByTitle('Preview selected file')).not.toBeInTheDocument();
  });

  it('surfaces compress for multi-select and properties for both selection sizes', () => {
    const onCompress = vi.fn();
    const onProperties = vi.fn();
    const { rerender } = render(
      <OperationBar
        {...mockProps}
        selectedFiles={new Set(['a.txt', 'b.txt'])}
        onCompress={onCompress}
        onProperties={onProperties}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Compress' }));
    expect(onCompress).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Properties' }));
    expect(onProperties).toHaveBeenCalledTimes(1);

    rerender(
      <OperationBar
        {...mockProps}
        selectedFiles={new Set(['a.txt'])}
        onCompress={onCompress}
        onProperties={onProperties}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Properties' }));
    expect(onProperties).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Compress' })).not.toBeInTheDocument();
  });

  it('shows paste only when clipboard content is available', () => {
    const onPaste = vi.fn();
    const { rerender } = render(
      <OperationBar {...mockProps} onPaste={onPaste} hasClipboard={false} />,
    );
    expect(screen.queryByTitle('Paste')).not.toBeInTheDocument();

    rerender(<OperationBar {...mockProps} onPaste={onPaste} hasClipboard />);
    fireEvent.click(screen.getByTitle('Paste'));
    expect(onPaste).toHaveBeenCalledTimes(1);
  });

  it('closes open dropdowns when clicking outside the toolbar', () => {
    render(<OperationBar {...mockProps} />);

    fireEvent.click(screen.getByText('Name'));
    expect(screen.getByText('Date Modified')).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByText('Date Modified')).not.toBeInTheDocument();
  });

  it('falls back safely when a saved sort or view id no longer exists', () => {
    expect(() =>
      render(<OperationBar {...mockProps} sortBy={'missing' as SortField} viewMode="missing" />),
    ).not.toThrow();
  });

  describe('responsive toolbar', () => {
    const paneWidths = new Map<string, number>();
    const observers: Array<{ callback: () => void; targets: Set<Element> }> = [];
    const restoreMeasurements: Array<() => void> = [];
    const onCreateFile = vi.fn();

    beforeEach(() => {
      paneWidths.clear();
      paneWidths.set('left', 700);
      paneWidths.set('right', 700);
      observers.length = 0;
      const boundingRect = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(function () {
          const pane = this.closest<HTMLElement>('.wisp-editor-pane');
          const width = paneWidths.get(pane?.dataset.testPane ?? 'left') ?? 0;
          return {
            width,
            height: 32,
            x: 0,
            y: 0,
            top: 0,
            bottom: 32,
            left: 0,
            right: width,
            toJSON: () => ({}),
          };
        });
      restoreMeasurements.push(() => boundingRect.mockRestore());
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
                target.closest<HTMLElement>('.wisp-editor-pane')?.dataset.testPane === pane,
            )
          ) {
            observer.callback();
          }
        }
      });
    };

    it('restores menu focus to the visible sort control when expanding a narrow pane', async () => {
      paneWidths.set('left', 320);
      render(
        <div className="wisp-editor-pane" data-test-pane="left">
          <OperationBar {...mockProps} />
        </div>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'More', exact: true }));
      screen.getByRole('menuitem', { name: 'Create folder', exact: true }).focus();

      resizePane('left', 700);

      await waitFor(() => expect(screen.getByRole('button', { name: /Sort by/ })).toHaveFocus());
    });

    it('restores a collapsed action to More without taking focus from the resize control', async () => {
      render(
        <>
          <div className="wisp-editor-pane" data-test-pane="left">
            <OperationBar {...mockProps} />
          </div>
          <button>Resize pane</button>
        </>,
      );
      screen.getByRole('button', { name: 'Create folder', exact: true }).focus();
      resizePane('left', 320);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'More', exact: true })).toHaveFocus(),
      );

      screen.getByRole('button', { name: 'Resize pane' }).focus();
      resizePane('left', 700);
      expect(screen.getByRole('button', { name: 'Resize pane' })).toHaveFocus();
    });

    it.each([
      [601, false, false, false],
      [600, true, false, false],
      [481, true, false, false],
      [480, true, true, false],
      [361, true, true, false],
      [360, true, true, true],
    ])(
      'retains accessible controls at the %ipx pane boundary',
      (width, compact, folderInMenu, browseInMenu) => {
        paneWidths.set('left', width);
        render(
          <section className="wisp-editor-pane" data-test-pane="left">
            <OperationBar {...mockProps} onCreateFile={onCreateFile} />
          </section>,
        );

        for (const name of ['AirDrop', 'New document', 'Open terminal']) {
          if (compact) {
            expect(screen.queryByRole('button', { name, exact: true })).not.toBeInTheDocument();
          } else {
            expect(screen.getByRole('button', { name, exact: true })).toBeInTheDocument();
          }
        }
        const folderButton = screen.queryByRole('button', { name: 'Create folder' });
        const sortButton = screen.queryByRole('button', { name: /Sort by/ });
        const viewButton = screen.queryByRole('button', { name: /View mode/ });
        expect(Boolean(folderButton)).toBe(!folderInMenu);
        expect(Boolean(sortButton)).toBe(!browseInMenu);
        expect(Boolean(viewButton)).toBe(!browseInMenu);
        if (compact) {
          fireEvent.click(screen.getByRole('button', { name: 'More', exact: true }));
          const menu = within(screen.getByRole('menu', { name: 'More' }));
          expect(menu.getByRole('menuitem', { name: /AirDrop/ })).toBeInTheDocument();
          expect(menu.getByRole('menuitem', { name: 'New document' })).toBeInTheDocument();
          expect(menu.getByRole('menuitem', { name: 'Open terminal' })).toBeInTheDocument();
          if (folderInMenu) {
            expect(menu.getByRole('menuitem', { name: 'Create folder' })).toBeInTheDocument();
          }
          if (browseInMenu) {
            expect(menu.getByRole('menuitemradio', { name: 'Size' })).toBeInTheDocument();
            expect(menu.getByRole('menuitemradio', { name: /Large Icons$/ })).toBeInTheDocument();
          }
        }
      },
    );

    it('adapts each pane independently and closes an obsolete overflow menu on expansion', () => {
      render(
        <>
          <section aria-label="Left pane" className="wisp-editor-pane" data-test-pane="left">
            <OperationBar {...mockProps} />
          </section>
          <section aria-label="Right pane" className="wisp-editor-pane" data-test-pane="right">
            <OperationBar {...mockProps} />
          </section>
        </>,
      );
      const left = within(screen.getByRole('region', { name: 'Left pane' }));
      const right = within(screen.getByRole('region', { name: 'Right pane' }));

      resizePane('left', 360);

      expect(left.queryByRole('button', { name: /Sort by/ })).not.toBeInTheDocument();
      expect(right.getByRole('button', { name: /Sort by/ })).toBeInTheDocument();
      expect(right.getByRole('button', { name: 'AirDrop', exact: true })).toBeInTheDocument();
      fireEvent.click(left.getByRole('button', { name: 'More', exact: true }));
      expect(screen.getByRole('menu', { name: 'More' })).toBeInTheDocument();

      resizePane('left', 700);

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(left.getByRole('button', { name: 'AirDrop', exact: true })).toBeInTheDocument();
      expect(left.getByRole('button', { name: /Sort by/ })).toBeInTheDocument();
    });

    it('executes collapsed file, clipboard, navigation and terminal actions', async () => {
      paneWidths.set('left', 320);
      const onPaste = vi.fn();
      const onRefresh = vi.fn();
      const onNavigateUp = vi.fn();
      render(
        <section className="wisp-editor-pane" data-test-pane="left">
          <OperationBar
            {...mockProps}
            onCreateFile={onCreateFile}
            onPaste={onPaste}
            hasClipboard
            onRefresh={onRefresh}
            onNavigateUp={onNavigateUp}
            canNavigateUp
          />
        </section>,
      );
      const runAction = (name: string | RegExp) => {
        fireEvent.click(screen.getByRole('button', { name: 'More', exact: true }));
        fireEvent.click(screen.getByRole('menuitem', { name }));
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      };

      runAction('Create folder');
      runAction('New document');
      runAction('Paste');
      runAction('Go up one level');
      runAction('Refresh');
      runAction('Open terminal');
      runAction(/AirDrop/);

      expect(mockProps.handleCreateFolder).toHaveBeenCalledOnce();
      expect(onCreateFile).toHaveBeenCalledOnce();
      expect(onPaste).toHaveBeenCalledOnce();
      expect(onNavigateUp).toHaveBeenCalledOnce();
      expect(onRefresh).toHaveBeenCalledOnce();
      expect(mockProps.setBottomPanelCollapsed).toHaveBeenCalledWith(false);
      expect(mockProps.setBottomPanelTab).toHaveBeenCalledWith('terminal');
      await waitFor(() => expect(openAirDrop).toHaveBeenCalledWith([]));
    });

    it('preserves checked sorting, view selection and date grouping inside the narrowest menu', () => {
      paneWidths.set('left', 360);
      const setGroupByDate = vi.fn();
      render(
        <section className="wisp-editor-pane" data-test-pane="left">
          <OperationBar {...mockProps} groupByDate setGroupByDate={setGroupByDate} />
        </section>,
      );
      const more = screen.getByRole('button', { name: 'More', exact: true });
      fireEvent.click(more);
      expect(screen.getByRole('menuitemradio', { name: 'Name' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(screen.getByRole('menuitemradio', { name: /Medium Icons$/ })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(screen.getByRole('menuitemcheckbox', { name: 'Group by Date' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Size' }));
      expect(mockProps.setSortBy).toHaveBeenCalledWith('size');

      fireEvent.click(more);
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Name' }));
      expect(mockProps.toggleSortOrder).toHaveBeenCalledOnce();

      fireEvent.click(more);
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Large Icons$/ }));
      expect(mockProps.setViewMode).toHaveBeenCalledWith('large');

      fireEvent.click(more);
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Group by Date' }));
      expect(setGroupByDate).toHaveBeenCalledWith(false);
    });

    it('keeps compressed selection actions and current selected AirDrop paths in overflow', async () => {
      paneWidths.set('left', 480);
      const selection = new Set(['/demo/one.txt', '/demo/two.txt']);
      const onCompress = vi.fn();
      const onExtract = vi.fn();
      const { rerender } = render(
        <section className="wisp-editor-pane" data-test-pane="left">
          <OperationBar
            {...mockProps}
            selectedFiles={selection}
            onCompress={onCompress}
            onExtract={onExtract}
          />
        </section>,
      );

      fireEvent.click(screen.getByRole('button', { name: 'More', exact: true }));
      expect(screen.queryByRole('menuitem', { name: 'Extract' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Compress' }));
      expect(onCompress).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole('button', { name: 'More', exact: true }));
      fireEvent.click(screen.getByRole('menuitem', { name: /AirDrop/ }));
      await waitFor(() => expect(openAirDrop).toHaveBeenCalledWith([...selection]));

      rerender(
        <section className="wisp-editor-pane" data-test-pane="left">
          <OperationBar
            {...mockProps}
            selectedFiles={new Set(['/demo/archive.zip'])}
            onCompress={onCompress}
            onExtract={onExtract}
          />
        </section>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'More', exact: true }));
      expect(screen.queryByRole('menuitem', { name: 'Compress' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Extract' }));
      expect(onExtract).toHaveBeenCalledOnce();
    });

    it.each(['Enter', ' '])(
      'retains color filter checkboxes in overflow and activates them with %s',
      async (key) => {
        paneWidths.set('left', 480);
        const user = userEvent.setup();
        const onColorFilter = vi.fn();
        render(
          <section className="wisp-editor-pane" data-test-pane="left">
            <OperationBar
              {...mockProps}
              overflowAccessory={
                <div role="group" aria-label="Folder colors">
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked="true"
                    tabIndex={-1}
                    onClick={() => onColorFilter('blue')}
                  >
                    Blue folders
                  </button>
                </div>
              }
            />
          </section>,
        );
        const more = screen.getByRole('button', { name: 'More', exact: true });
        more.focus();
        await user.keyboard('{ArrowUp}');
        const color = screen.getByRole('menuitemcheckbox', { name: 'Blue folders' });
        expect(color).toHaveAttribute('aria-checked', 'true');
        await waitFor(() => expect(color).toHaveFocus());

        await user.keyboard(key === 'Enter' ? '{Enter}' : ' ');

        expect(onColorFilter).toHaveBeenCalledWith('blue');
        expect(onColorFilter).toHaveBeenCalledOnce();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(more).toHaveFocus();
      },
    );

    it('does not steal dialog input focus after creating a folder from overflow', () => {
      paneWidths.set('left', 480);
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((callback: FrameRequestCallback) => {
          frames.push(callback);
          return frames.length;
        }),
      );
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
      const FolderCreation = () => {
        const [dialogOpen, setDialogOpen] = useState(false);
        const inputRef = useRef<HTMLInputElement>(null);
        return (
          <section className="wisp-editor-pane" data-test-pane="left">
            <OperationBar
              {...mockProps}
              handleCreateFolder={() => {
                flushSync(() => setDialogOpen(true));
                inputRef.current?.focus();
              }}
            />
            {dialogOpen && (
              <div role="dialog" aria-label="Create folder">
                <input ref={inputRef} aria-label="Folder name" />
              </div>
            )}
          </section>
        );
      };
      render(<FolderCreation />);
      fireEvent.click(screen.getByRole('button', { name: 'More', exact: true }), { detail: 1 });

      fireEvent.click(screen.getByRole('menuitem', { name: 'Create folder' }));

      const input = screen.getByRole('textbox', { name: 'Folder name' });
      expect(screen.getByRole('dialog', { name: 'Create folder' })).toBeInTheDocument();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(input).toHaveFocus();
      act(() => {
        for (const frame of frames.splice(0)) frame(16);
      });
      expect(input).toHaveFocus();
    });

    it.each(['Enter', ' '])(
      'opens overflow with %s and resumes native forward and backward tab order',
      async (key) => {
        paneWidths.set('left', 480);
        const user = userEvent.setup();
        const rects = vi
          .spyOn(HTMLElement.prototype, 'getClientRects')
          .mockReturnValue([{}] as unknown as DOMRectList);
        restoreMeasurements.push(() => rects.mockRestore());
        render(
          <section className="wisp-editor-pane" data-test-pane="left">
            <OperationBar {...mockProps} />
            <button type="button">After toolbar</button>
          </section>,
        );
        const more = screen.getByRole('button', { name: 'More', exact: true });
        const openWithKeyboard = async () => {
          more.focus();
          await user.keyboard(key === 'Enter' ? '{Enter}' : ' ');
          await waitFor(() =>
            expect(screen.getByRole('menuitem', { name: 'Create folder' })).toHaveFocus(),
          );
        };

        await openWithKeyboard();
        await user.tab();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'After toolbar' })).toHaveFocus();

        await openWithKeyboard();
        await user.tab({ shift: true });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /View mode/ })).toHaveFocus();
      },
    );

    it('prevents repeated AirDrop launches when overflow is reopened while a launch is pending', async () => {
      paneWidths.set('left', 480);
      let finish!: () => void;
      openAirDrop.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const user = userEvent.setup();
      render(
        <section className="wisp-editor-pane" data-test-pane="left">
          <OperationBar {...mockProps} />
        </section>,
      );
      const more = screen.getByRole('button', { name: 'More', exact: true });
      await user.click(more);
      await user.click(screen.getByRole('menuitem', { name: 'AirDrop', exact: true }));
      expect(openAirDrop).toHaveBeenCalledOnce();
      await user.click(more);
      const airDrop = screen.getByRole('menuitem', { name: 'AirDrop', exact: true });
      expect(airDrop).toBeDisabled();
      await user.click(airDrop);
      expect(openAirDrop).toHaveBeenCalledOnce();

      await act(async () => finish());

      expect(airDrop).toBeEnabled();
      expect(toast).not.toHaveBeenCalled();
      await user.click(airDrop);
      expect(openAirDrop).toHaveBeenCalledTimes(2);
    });

    it('opens overflow through the keyboard, skips disabled actions and restores focus on Escape', async () => {
      paneWidths.set('left', 480);
      const user = userEvent.setup();
      const onNavigateUp = vi.fn();
      render(
        <section className="wisp-editor-pane" data-test-pane="left">
          <OperationBar {...mockProps} onNavigateUp={onNavigateUp} canNavigateUp={false} />
        </section>,
      );
      const more = screen.getByRole('button', { name: 'More', exact: true });
      more.focus();
      await user.keyboard('{ArrowDown}');
      const disabledUp = screen.getByRole('menuitem', { name: 'Go up one level' });
      expect(disabledUp).toBeDisabled();
      await waitFor(() =>
        expect(screen.getByRole('menu')).toContainElement(document.activeElement as HTMLElement),
      );
      const enabledItems = screen
        .getAllByRole('menuitem')
        .filter((item) => !(item as HTMLButtonElement).disabled);
      for (let index = 0; index < enabledItems.length + 1; index++) {
        await user.keyboard('{ArrowDown}');
        expect(disabledUp).not.toHaveFocus();
      }
      await user.keyboard('{Escape}');
      await waitFor(() => expect(more).toHaveFocus());
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(onNavigateUp).not.toHaveBeenCalled();
    });
  });
});
