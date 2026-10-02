import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchFileContentChanged,
  dispatchLocalFilesChanged,
  FILE_CONTENT_CHANGED_EVENT,
  notifyFilesChanged,
} from '@/lib/file-change-events';

describe('file change events', () => {
  it('dispatches the local refresh event', () => {
    const listener = vi.fn();
    window.addEventListener('files-changed', listener);

    dispatchLocalFilesChanged();

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('files-changed', listener);
  });

  it('always refreshes the current window immediately', async () => {
    const listener = vi.fn();
    window.addEventListener('files-changed', listener);

    await notifyFilesChanged();

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('files-changed', listener);
  });
});

describe('content change batches', () => {
  let listener: ReturnType<typeof vi.fn>;
  const paths = () =>
    listener.mock.calls.map(([event]) => (event as CustomEvent<{ path: string }>).detail.path);

  beforeEach(() => {
    vi.useFakeTimers();
    listener = vi.fn();
    window.addEventListener(FILE_CONTENT_CHANGED_EVENT, listener);
  });

  afterEach(() => {
    window.removeEventListener(FILE_CONTENT_CHANGED_EVENT, listener);
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('coalesces the same path from multiple panes without extending the batch deadline', () => {
    dispatchFileContentChanged('/Documents/deck.pptx');
    vi.advanceTimersByTime(100);
    dispatchFileContentChanged('/Documents/deck.pptx');
    vi.advanceTimersByTime(149);
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(paths()).toEqual(['/Documents/deck.pptx']);
  });

  it('dispatches each different path once within the same batch', () => {
    dispatchFileContentChanged('/Documents/deck.pptx');
    vi.advanceTimersByTime(100);
    dispatchFileContentChanged('/Documents/report.pdf');
    dispatchFileContentChanged('/Documents/deck.pptx');

    vi.advanceTimersByTime(150);

    expect(paths()).toEqual(['/Documents/deck.pptx', '/Documents/report.pdf']);
  });

  it('dispatches a new update to the same path in the next batch', () => {
    dispatchFileContentChanged('/Documents/report.pdf');
    vi.advanceTimersByTime(250);
    dispatchFileContentChanged('/Documents/report.pdf');

    vi.advanceTimersByTime(250);

    expect(paths()).toEqual(['/Documents/report.pdf', '/Documents/report.pdf']);
  });

  it('keeps dispatching while new notifications arrive continuously', () => {
    for (let index = 0; index < 5; index += 1) {
      dispatchFileContentChanged('/Documents/report.pdf');
      vi.advanceTimersByTime(50);
    }
    expect(listener).toHaveBeenCalledOnce();

    for (let index = 0; index < 5; index += 1) {
      dispatchFileContentChanged('/Documents/report.pdf');
      vi.advanceTimersByTime(50);
    }

    expect(paths()).toEqual(['/Documents/report.pdf', '/Documents/report.pdf']);
  });

  it('retains changes queued by a listener during delivery for the next batch', () => {
    listener.mockImplementationOnce(() => dispatchFileContentChanged('/Documents/next.pdf'));
    dispatchFileContentChanged('/Documents/first.pdf');

    vi.advanceTimersByTime(250);
    expect(paths()).toEqual(['/Documents/first.pdf']);

    vi.advanceTimersByTime(250);
    expect(paths()).toEqual(['/Documents/first.pdf', '/Documents/next.pdf']);
  });
});
