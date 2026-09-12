import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/react';
import PaneFileExplorer from '@/components/split-view/PaneFileExplorer';

vi.mock('@/lib/utils', async (importOriginal) => importOriginal());
vi.mock('@/contexts/ExplorerContext', () => ({
  useClipboardContext: () => ({ hasClipboard: false }),
}));
vi.mock('@/hooks/use-smart-view', () => ({
  useSmartView: () => ({
    suggestedView: 'details',
    setSavedView: vi.fn(),
    clearSavedView: vi.fn(),
    isAutoDetected: false,
  }),
}));
vi.mock('@/components/explorer/FileGrid', () => ({ default: () => <div>Files</div> }));
vi.mock('@/components/explorer/FolderColorLegend', () => ({ default: () => null }));
vi.mock('@/components/explorer/SizeDistributionChart', () => ({
  SizeDistributionChart: () => null,
}));

const props: ComponentProps<typeof PaneFileExplorer> = {
  viewMode: 'details',
  setViewMode: vi.fn(),
  sortBy: 'name',
  setSortBy: vi.fn(),
  sortOrder: 'asc',
  toggleSortOrder: vi.fn(),
  groupByDate: false,
  setGroupByDate: vi.fn(),
  sortedFiles: [],
  fileGroups: null,
  isLoading: true,
  selectedFiles: new Set(),
  setSelectedFiles: vi.fn(),
  currentPath: '/fixture',
  groupId: 'pane',
  handleCreateFolder: vi.fn(),
  handleDelete: vi.fn(),
  handleFileClick: vi.fn(),
  handleFileDoubleClick: vi.fn(),
  onFileRightClick: vi.fn(),
  onBgRightClick: vi.fn(),
  getFolderSize: () => null,
  isCalculatingSize: () => false,
  calculateFolderSize: vi.fn(),
  setBottomPanelCollapsed: vi.fn(),
  setBottomPanelTab: vi.fn(),
  onAdvancedSelection: vi.fn(),
};

describe('PaneFileExplorer toolbar placement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the toolbar inline when no navigation outlet is available', () => {
    const { container } = render(<PaneFileExplorer {...props} />);
    fireEvent.click(within(container).getByTitle('Create folder'));
    expect(props.handleCreateFolder).toHaveBeenCalledOnce();
    expect(container.querySelectorAll('.wisp-operationbar')).toHaveLength(1);
  });

  it('keeps actions and selection updates working in the outlet and clears it on unmount', () => {
    const outlet = document.createElement('div');
    document.body.appendChild(outlet);
    const { container, rerender, unmount } = render(
      <PaneFileExplorer {...props} toolbarTarget={outlet} />,
    );

    expect(container.querySelector('.wisp-operationbar')).not.toBeInTheDocument();
    fireEvent.click(within(outlet).getByTitle('Create folder'));
    expect(props.handleCreateFolder).toHaveBeenCalledOnce();

    rerender(
      <PaneFileExplorer
        {...props}
        toolbarTarget={outlet}
        selectedFiles={new Set(['/fixture/notes.txt'])}
      />,
    );
    expect(outlet.querySelector('.wisp-selection-toolbar')).toBeInTheDocument();
    fireEvent.click(within(outlet).getByRole('button', { name: 'Clear Selection' }));
    expect(props.setSelectedFiles).toHaveBeenCalledWith(new Set());

    unmount();
    expect(outlet).toBeEmptyDOMElement();
    outlet.remove();
  });
});
