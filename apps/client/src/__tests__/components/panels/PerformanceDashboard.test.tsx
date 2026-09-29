import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PerformanceDashboard from '@/components/panels/PerformanceDashboard';
const refresh = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-performance-stats', () => ({
  usePerformanceStats: () => ({ suggestions: [], isLoading: false, refreshStats: refresh }),
}));
vi.mock('@/components/panels/performance/PerformanceCharts', () => ({
  default: ({ currentPath }: { currentPath: string }) => (
    <div data-testid="organizer">{currentPath}</div>
  ),
}));
const props = { currentPath: '/work', allFiles: [], navigateToPath: vi.fn() };
beforeEach(() => vi.clearAllMocks());
describe('File actions panel', () => {
  it('offers trash, batch rename and the current folder organizer', () => {
    render(<PerformanceDashboard {...props} />);
    expect(screen.getByRole('button', { name: 'File actions' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('Batch Rename')).toBeInTheDocument();
    expect(screen.getByTestId('organizer')).toHaveTextContent('/work');
  });
  it('collapses both sections without executing any action', () => {
    render(<PerformanceDashboard {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryByText('Batch Rename')).not.toBeInTheDocument();
    expect(screen.queryByTestId('organizer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'File actions' }));
    expect(screen.getByText('Batch Rename')).toBeInTheDocument();
  });
  it('refreshes the current folder information', () => {
    render(<PerformanceDashboard {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refresh).toHaveBeenCalledOnce();
  });
  it('does not advertise removed index or memory controls', () => {
    render(<PerformanceDashboard {...props} />);
    expect(screen.queryByText('JS Heap Usage')).not.toBeInTheDocument();
    expect(screen.queryByText('Reindex')).not.toBeInTheDocument();
  });
});
