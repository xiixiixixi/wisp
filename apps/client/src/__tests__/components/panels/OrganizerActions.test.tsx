import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import Organizer from '@/components/panels/performance/PerformanceCharts';
import { TauriAPI, type OrganizationAnalysis, type OrganizationPlan } from '@/lib/tauri-api';
vi.mock('@/lib/tauri-api', () => ({
  TauriAPI: {
    analyzeDirectory: vi.fn(),
    previewOrganization: vi.fn(),
    executeOrganization: vi.fn(),
  },
}));
const analysis: OrganizationAnalysis = {
  categories: [],
  suggestions: [
    {
      suggested_name: 'Documents',
      category: 'type',
      target_path: '/work/Documents',
      files_to_move: ['/work/report.txt'],
      reason: 'Group documents',
    },
  ],
  duplicate_summary: null,
  insights: {
    total_files: 1,
    total_size: 1,
    largest_files: [],
    oldest_files: [],
    newest_files: [],
    type_distribution: [],
    avg_file_size: 1,
    files_by_month: [],
  },
  is_project: false,
  project_type: null,
};
const plan: OrganizationPlan = {
  creates: ['/work/Documents'],
  moves: [
    { from: '/work/report.txt', to: '/work/Documents/report.txt', reason: 'Group documents' },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(TauriAPI.analyzeDirectory).mockResolvedValue(analysis);
  vi.mocked(TauriAPI.previewOrganization).mockResolvedValue(plan);
});
it('invalidates a reviewed move plan after the selected suggestion changes', async () => {
  render(<Organizer currentPath="/work" />);
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  await screen.findByRole('button', { name: 'Move 1 files' });
  expect(screen.getByText('/work/report.txt')).toBeInTheDocument();
  expect(screen.getByText('/work/Documents/report.txt')).toBeInTheDocument();
  expect(screen.getByText(/no one-click undo/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.queryByRole('button', { name: 'Move 1 files' })).not.toBeInTheDocument();
  expect(TauriAPI.executeOrganization).not.toHaveBeenCalled();
});
it('discards a delayed plan if the selection changes before it arrives', async () => {
  let finish!: (plan: OrganizationPlan) => void;
  vi.mocked(TauriAPI.previewOrganization).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<Organizer currentPath="/work" />);
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  fireEvent.click(screen.getByRole('checkbox'));
  await act(async () => finish(plan));
  expect(screen.queryByRole('button', { name: 'Move 1 files' })).not.toBeInTheDocument();
});
it('does not retry an already partially applied plan after an execution failure', async () => {
  vi.mocked(TauriAPI.executeOrganization).mockRejectedValue(new Error('Destination unavailable'));
  render(<Organizer currentPath="/work" />);
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Move 1 files' }));
  expect(await screen.findByText(/Some files may already have moved/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Move 1 files' })).not.toBeInTheDocument();
});
