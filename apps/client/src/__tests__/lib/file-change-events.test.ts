import { describe, expect, it, vi } from 'vitest';
import { dispatchLocalFilesChanged, notifyFilesChanged } from '@/lib/file-change-events';

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
