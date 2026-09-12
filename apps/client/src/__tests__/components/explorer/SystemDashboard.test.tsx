import type { ComponentType } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSystemStats, getTopProcesses, isBrowserDemoMode } = vi.hoisted(() => ({
  getSystemStats: vi.fn(),
  getTopProcesses: vi.fn(),
  isBrowserDemoMode: vi.fn(),
}));
vi.mock('@/lib/tauri-api', () => ({ TauriAPI: { getSystemStats, getTopProcesses } }));
vi.mock('@/lib/browser-demo-files', () => ({ isBrowserDemoMode }));

const stats = {
  cpu_usage: 14,
  mem_total: 1000,
  mem_used: 500,
  disk_total: 2000,
  disk_available: 250,
};
const processes = Array.from({ length: 8 }, (_, index) => ({
  pid: index + 1,
  name: `Process ${index + 1}`,
  cpu_usage: 20 - index,
  memory: 100,
}));
let SystemDashboard: ComponentType;
let visibility: DocumentVisibilityState;

const renderReady = async () => {
  const result = render(<SystemDashboard />);
  await act(async () => {});
  return result;
};
const toggleDetails = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /System/ }));
  });
};
const changeVisibility = async (value: DocumentVisibilityState) => {
  await act(async () => {
    visibility = value;
    fireEvent(document, new Event('visibilitychange'));
  });
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
  vi.resetModules();
  vi.clearAllMocks();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  isBrowserDemoMode.mockReturnValue(false);
  getSystemStats.mockResolvedValue(stats);
  getTopProcesses.mockResolvedValue(processes);
  SystemDashboard = (await import('@/components/explorer/SystemDashboard')).default;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SystemDashboard', () => {
  it('renders no placeholder or native requests in browser demo mode', async () => {
    isBrowserDemoMode.mockReturnValue(true);
    const { container } = await renderReady();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(container).toBeEmptyDOMElement();
    expect(getSystemStats).not.toHaveBeenCalled();
    expect(getTopProcesses).not.toHaveBeenCalled();
  });

  it('defaults to a cached summary and avoids process sampling while collapsed', async () => {
    const first = await renderReady();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('250 B available')).toBeInTheDocument();
    expect(screen.getByText('50% memory used')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(getSystemStats).toHaveBeenCalledTimes(1);
    expect(getTopProcesses).not.toHaveBeenCalled();

    first.unmount();
    await renderReady();
    expect(getSystemStats).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(getSystemStats).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getSystemStats).toHaveBeenCalledTimes(2);
    expect(getTopProcesses).not.toHaveBeenCalled();
  });

  it('loads complete returned details on expansion and stops process polling on collapse', async () => {
    await renderReady();
    await toggleDetails();
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(button.getAttribute('aria-controls')!)).toBeVisible();
    expect(screen.getByText('500 B of 1000 B used')).toBeInTheDocument();
    expect(screen.getByText('250 B of 2000 B available')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(9);
    expect(screen.getByText('Process 8')).toBeInTheDocument();
    expect(getTopProcesses).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getSystemStats).toHaveBeenCalledTimes(2);
    expect(getTopProcesses).toHaveBeenCalledTimes(2);
    await toggleDetails();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getSystemStats).toHaveBeenCalledTimes(2);
    expect(getTopProcesses).toHaveBeenCalledTimes(2);
  });

  it('pauses all native sampling while hidden and refreshes visible expanded details', async () => {
    visibility = 'hidden';
    const { container } = await renderReady();
    expect(container).toBeEmptyDOMElement();
    expect(getSystemStats).not.toHaveBeenCalled();
    await changeVisibility('visible');
    await toggleDetails();
    expect(getSystemStats).toHaveBeenCalledTimes(1);
    expect(getTopProcesses).toHaveBeenCalledTimes(1);

    await changeVisibility('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(getSystemStats).toHaveBeenCalledTimes(1);
    expect(getTopProcesses).toHaveBeenCalledTimes(1);
    await changeVisibility('visible');
    expect(getSystemStats).toHaveBeenCalledTimes(2);
    expect(getTopProcesses).toHaveBeenCalledTimes(2);
  });

  it('hides unavailable data, retries slowly, and retains the last valid summary on failures', async () => {
    getSystemStats.mockRejectedValueOnce(new Error('Unavailable'));
    const { container } = await renderReady();
    expect(container).toBeEmptyDOMElement();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByText('250 B available')).toBeInTheDocument();

    getSystemStats.mockRejectedValue(new Error('Unavailable'));
    getTopProcesses.mockRejectedValue(new Error('Unavailable'));
    await toggleDetails();
    expect(screen.getByText('Process details are currently unavailable.')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText('250 B available')).toBeInTheDocument();
  });

  it('never overlaps a pending process sample or keeps polling after unmount', async () => {
    let finishProcesses!: (value: typeof processes) => void;
    getTopProcesses.mockReturnValue(
      new Promise<typeof processes>((resolve) => {
        finishProcesses = resolve;
      }),
    );
    const { unmount } = await renderReady();
    await toggleDetails();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(getTopProcesses).toHaveBeenCalledTimes(1);
    await toggleDetails();
    await act(async () => {
      finishProcesses(processes);
    });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    unmount();
    const statsCalls = getSystemStats.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(getSystemStats).toHaveBeenCalledTimes(statsCalls);
    expect(getTopProcesses).toHaveBeenCalledTimes(1);
  });
});
