import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecentDirectory } from '@/hooks/use-recent-directory';
import { recordSuccessfulVisit } from '@/lib/recent-entry-actions';

vi.mock('@/lib/recent-entry-actions', async (original) => ({
  ...(await original<typeof import('@/lib/recent-entry-actions')>()),
  recordSuccessfulVisit: vi.fn(async () => {}),
}));
beforeEach(() => vi.clearAllMocks());

describe('directory visit history', () => {
  it('waits for successful data and ignores watcher refetches', () => {
    const { rerender } = renderHook(({ ready }) => useRecentDirectory('/Documents', ready), {
      initialProps: { ready: false },
    });
    expect(recordSuccessfulVisit).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(recordSuccessfulVisit).toHaveBeenCalledTimes(1);
    expect(recordSuccessfulVisit).toHaveBeenCalledWith('/Documents');
    rerender({ ready: false });
    rerender({ ready: true });
    expect(recordSuccessfulVisit).toHaveBeenCalledTimes(1);
  });

  it('records a return visit but not an unsuccessful or virtual location', () => {
    const { rerender } = renderHook(({ path, ready }) => useRecentDirectory(path, ready), {
      initialProps: { path: '/Documents', ready: true },
    });
    rerender({ path: '/Offline', ready: false });
    rerender({ path: 'wisp://home', ready: true });
    rerender({ path: '/Documents', ready: true });
    expect(recordSuccessfulVisit).toHaveBeenCalledTimes(2);
    expect(recordSuccessfulVisit).toHaveBeenLastCalledWith('/Documents');
  });
});
