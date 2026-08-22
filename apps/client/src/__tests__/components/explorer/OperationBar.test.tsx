import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import OperationBar from '@/components/explorer/OperationBar';
import type { SortField } from '@/lib/utils';

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
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.queryByText('Medium Icons')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear Selection' }));
    expect(onSelectNone).toHaveBeenCalledTimes(1);
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

  it('surfaces compress for multi-select and properties for a single item', () => {
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
    expect(screen.queryByRole('button', { name: 'Properties' })).not.toBeInTheDocument();

    rerender(
      <OperationBar
        {...mockProps}
        selectedFiles={new Set(['a.txt'])}
        onCompress={onCompress}
        onProperties={onProperties}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Properties' }));
    expect(onProperties).toHaveBeenCalledTimes(1);
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

  it('exposes secondary create and file-management actions from the menu', () => {
    const onCreateFile = vi.fn();
    const onCompress = vi.fn();
    const onProperties = vi.fn();
    render(
      <OperationBar
        {...mockProps}
        onCreateFile={onCreateFile}
        onCompress={onCompress}
        onProperties={onProperties}
      />,
    );

    fireEvent.click(screen.getByTitle('File actions menu'));
    fireEvent.click(screen.getByText('New File'));
    expect(onCreateFile).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('File actions menu'));
    fireEvent.click(screen.getByText('Compress'));
    expect(onCompress).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('File actions menu'));
    fireEvent.click(screen.getByText('Properties'));
    expect(onProperties).toHaveBeenCalledTimes(1);
  });

  it('closes open dropdowns when clicking outside the toolbar', () => {
    render(<OperationBar {...mockProps} />);

    fireEvent.click(screen.getByText('Name'));
    expect(screen.getByText('Date Modified')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Date Modified')).not.toBeInTheDocument();
  });

  it('falls back safely when a saved sort or view id no longer exists', () => {
    expect(() =>
      render(<OperationBar {...mockProps} sortBy={'missing' as SortField} viewMode="missing" />),
    ).not.toThrow();
  });
});
