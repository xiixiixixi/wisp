import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChangeSummaryToast from '@/components/ui/ChangeSummaryToast';
import type { FileChangeSet } from '@/hooks/use-focus-change-tracker';

const changes: FileChangeSet = {
  added: [{ path: '/tmp/new.txt', name: 'new.txt', type: 'added' }],
  removed: [{ path: '/tmp/old.txt', name: 'old.txt', type: 'removed' }],
  modified: [{ path: '/tmp/changed.txt', name: 'changed.txt', type: 'modified' }],
  totalCount: 3,
  detectedAt: 1,
};

describe('ChangeSummaryToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses translated UI copy and limits live announcements to the summary', () => {
    render(<ChangeSummaryToast changes={changes} onDismiss={vi.fn()} onReview={vi.fn()} />);

    const region = screen.getByRole('region', { name: 'File change summary' });
    expect(region).toBeInTheDocument();
    expect(region).not.toHaveAttribute('aria-live');
    expect(screen.getByRole('status')).toHaveTextContent('3 files changed while you were away');
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
    expect(screen.getByText('3 files changed while you were away')).toBeInTheDocument();
    expect(screen.getByText('+1 new')).toBeInTheDocument();
    expect(screen.getByText('-1 deleted')).toBeInTheDocument();
    expect(screen.getByText('~1 modified')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    expect(screen.getByText('Added')).toBeInTheDocument();
    expect(screen.getByText('Removed')).toBeInTheDocument();
    expect(screen.getByText('Modified')).toBeInTheDocument();
  });

  it('provides an explicit accessible close control', async () => {
    const onDismiss = vi.fn();
    render(<ChangeSummaryToast changes={changes} onDismiss={onDismiss} onReview={vi.fn()} />);

    const region = screen.getByRole('region', { name: 'File change summary' });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss file change summary' }));

    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(region).toHaveStyle({ pointerEvents: 'none' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(280);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('runs only one dismiss callback while fading out', async () => {
    const onDismiss = vi.fn();
    render(<ChangeSummaryToast changes={changes} onDismiss={onDismiss} onReview={vi.fn()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    const region = screen.getByRole('region', { name: 'File change summary' });
    const close = screen.getByRole('button', { name: 'Dismiss file change summary' });
    fireEvent.click(close);
    fireEvent.click(close);

    expect(region).toHaveStyle({ pointerEvents: 'none' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('runs only one review callback while fading out', async () => {
    const onReview = vi.fn();
    render(<ChangeSummaryToast changes={changes} onDismiss={vi.fn()} onReview={onReview} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    const review = screen.getByRole('button', { name: 'Review' });
    fireEvent.click(review);
    fireEvent.click(review);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onReview).toHaveBeenCalledOnce();
  });

  it('cancels the pending exit callback when unmounted', async () => {
    const onDismiss = vi.fn();
    const { unmount } = render(
      <ChangeSummaryToast changes={changes} onDismiss={onDismiss} onReview={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss file change summary' }));
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
