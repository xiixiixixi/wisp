import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDirectoryWatch } from '@/hooks/use-directory-watch';

const api = vi.hoisted(() => ({
  listenToEvent: vi.fn(),
  watchDirectory: vi.fn(),
  unwatchDirectory: vi.fn(),
  dispatchFileContentChanged: vi.fn(),
}));
vi.mock('@/lib/tauri-api', () => ({ TauriAPI: api }));
vi.mock('@/lib/file-change-events', () => ({
  dispatchFileContentChanged: api.dispatchFileContentChanged,
}));

type ChangeEvent = { watcher_id: string; path: string; event_type: string };
let listeners: Array<(event: ChangeEvent) => void>;
let unlisten: ReturnType<typeof vi.fn>;
const flush = async () => {
  await act(async () => {});
};
const advance = (milliseconds: number) => act(() => vi.advanceTimersByTime(milliseconds));
const options = () => ({
  path: '/Documents',
  enabled: true,
  onChange: vi.fn(),
  onReconcile: vi.fn(),
  onDirectoryRemoved: vi.fn(),
});
const event = (changes: Partial<ChangeEvent> = {}): ChangeEvent => ({
  watcher_id: 'watch-1',
  path: '/Documents/file.txt',
  event_type: 'file-modified',
  ...changes,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  listeners = [];
  unlisten = vi.fn();
  api.listenToEvent.mockImplementation((_name, callback) => {
    listeners.push(callback);
    return Promise.resolve(unlisten);
  });
  api.watchDirectory.mockResolvedValue('watch-1');
  api.unwatchDirectory.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('live directory watching', () => {
  it('does not subscribe for virtual or disabled locations', async () => {
    renderHook(() => useDirectoryWatch({ ...options(), enabled: false }));
    await flush();
    expect(api.listenToEvent).not.toHaveBeenCalled();
    expect(api.watchDirectory).not.toHaveBeenCalled();
  });

  it('reconciles writes during watch startup even before its id is returned', async () => {
    let finish!: (id: string) => void;
    api.watchDirectory.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    const props = options();
    renderHook(() => useDirectoryWatch(props));
    await flush();
    act(() => listeners[0](event()));
    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onReconcile).not.toHaveBeenCalled();
    await act(async () => finish('watch-1'));
    expect(props.onChange).toHaveBeenCalledOnce();
    expect(props.onReconcile).toHaveBeenCalledOnce();
  });

  it('coalesces a write burst and notifies exact content paths after it settles', async () => {
    const props = options();
    renderHook(() => useDirectoryWatch(props));
    await flush();
    props.onChange.mockClear();
    props.onReconcile.mockClear();
    act(() => listeners[0](event()));
    advance(300);
    act(() => listeners[0](event()));
    advance(399);
    expect(props.onChange).not.toHaveBeenCalled();
    advance(1);
    expect(props.onChange).toHaveBeenCalledOnce();
    expect(api.dispatchFileContentChanged).toHaveBeenCalledOnce();
    expect(api.dispatchFileContentChanged).toHaveBeenCalledWith('/Documents/file.txt');
    expect(props.onReconcile).not.toHaveBeenCalled();
  });

  it('ignores notifications for another watcher', async () => {
    const props = options();
    renderHook(() => useDirectoryWatch(props));
    await flush();
    props.onChange.mockClear();
    act(() => listeners[0](event({ watcher_id: 'other-watch' })));
    advance(400);
    expect(props.onChange).not.toHaveBeenCalled();
    expect(api.dispatchFileContentChanged).not.toHaveBeenCalled();
  });

  it('recovers a removed directory without trying to reload its content', async () => {
    const props = options();
    renderHook(() => useDirectoryWatch(props));
    await flush();
    props.onChange.mockClear();
    act(() => listeners[0](event({ path: props.path, event_type: 'file-deleted' })));
    advance(400);
    expect(props.onDirectoryRemoved).toHaveBeenCalledOnce();
    expect(props.onChange).not.toHaveBeenCalled();
    expect(api.dispatchFileContentChanged).not.toHaveBeenCalled();
  });

  it('uses current callbacks without restarting a healthy watcher', async () => {
    const props = options();
    const { rerender } = renderHook((current) => useDirectoryWatch(current), {
      initialProps: props,
    });
    await flush();
    props.onChange.mockClear();
    const latest = { ...props, onChange: vi.fn() };
    rerender(latest);
    act(() => listeners[0](event()));
    advance(400);
    expect(latest.onChange).toHaveBeenCalledOnce();
    expect(props.onChange).not.toHaveBeenCalled();
    expect(api.watchDirectory).toHaveBeenCalledOnce();
  });

  it('unsubscribes a listener that finishes registering after unmount', async () => {
    let finish!: (stop: () => void) => void;
    api.listenToEvent.mockReturnValue(
      new Promise<() => void>((resolve) => {
        finish = resolve;
      }),
    );
    const { unmount } = renderHook(() => useDirectoryWatch(options()));
    unmount();
    await act(async () => finish(unlisten));
    expect(unlisten).toHaveBeenCalledOnce();
    expect(api.watchDirectory).not.toHaveBeenCalled();
  });

  it('stops a watcher whose id arrives after unmount', async () => {
    let finish!: (id: string) => void;
    api.watchDirectory.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    const props = options();
    const { unmount } = renderHook(() => useDirectoryWatch(props));
    await flush();
    unmount();
    await act(async () => finish('late-watch'));
    expect(unlisten).toHaveBeenCalledOnce();
    expect(api.unwatchDirectory).toHaveBeenCalledOnce();
    expect(api.unwatchDirectory).toHaveBeenCalledWith('late-watch');
    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onReconcile).not.toHaveBeenCalled();
  });

  it('cancels old events and pending refreshes when the path changes', async () => {
    const props = options();
    const { rerender } = renderHook((current) => useDirectoryWatch(current), {
      initialProps: props,
    });
    await flush();
    const oldListener = listeners[0];
    act(() => oldListener(event()));
    act(() => window.dispatchEvent(new Event('focus')));
    const next = { ...options(), path: '/Other' };
    api.watchDirectory.mockResolvedValue('watch-2');
    rerender(next);
    await flush();
    expect(next.onReconcile).toHaveBeenCalledOnce();
    next.onChange.mockClear();
    next.onReconcile.mockClear();
    act(() => oldListener(event()));
    advance(400);
    expect(api.unwatchDirectory).toHaveBeenCalledWith('watch-1');
    expect(next.onChange).not.toHaveBeenCalled();
    expect(next.onReconcile).not.toHaveBeenCalled();
    expect(api.dispatchFileContentChanged).not.toHaveBeenCalled();
  });

  it('refreshes when the user returns to the visible window', async () => {
    const props = options();
    const { unmount } = renderHook(() => useDirectoryWatch(props));
    await flush();
    props.onChange.mockClear();
    props.onReconcile.mockClear();
    act(() => window.dispatchEvent(new Event('focus')));
    advance(400);
    expect(props.onChange).toHaveBeenCalledOnce();
    expect(props.onReconcile).toHaveBeenCalledOnce();
    unmount();
    act(() => window.dispatchEvent(new Event('focus')));
    advance(400);
    expect(props.onChange).toHaveBeenCalledOnce();
    expect(props.onReconcile).toHaveBeenCalledOnce();
  });

  it('coalesces focus and visibility changes with the existing refresh delay', async () => {
    const props = options();
    renderHook(() => useDirectoryWatch(props));
    await flush();
    props.onChange.mockClear();
    props.onReconcile.mockClear();
    act(() => window.dispatchEvent(new Event('focus')));
    advance(200);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    advance(399);
    expect(props.onReconcile).not.toHaveBeenCalled();
    advance(1);
    expect(props.onChange).toHaveBeenCalledOnce();
    expect(props.onReconcile).toHaveBeenCalledOnce();
    expect(api.dispatchFileContentChanged).not.toHaveBeenCalled();
  });

  it('does not reconcile focus or visibility changes while the document is hidden', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const props = options();
    renderHook(() => useDirectoryWatch(props));
    await flush();
    props.onChange.mockClear();
    props.onReconcile.mockClear();
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    advance(400);
    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onReconcile).not.toHaveBeenCalled();

    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    advance(400);
    expect(props.onChange).toHaveBeenCalledOnce();
    expect(props.onReconcile).toHaveBeenCalledOnce();
    hidden.mockRestore();
  });

  it('uses the latest reconciliation callback without restarting the watcher', async () => {
    const props = options();
    const { rerender } = renderHook((current) => useDirectoryWatch(current), {
      initialProps: props,
    });
    await flush();
    props.onReconcile.mockClear();
    act(() => window.dispatchEvent(new Event('focus')));
    const latest = { ...props, onReconcile: vi.fn() };
    rerender(latest);
    advance(400);
    expect(latest.onReconcile).toHaveBeenCalledOnce();
    expect(props.onReconcile).not.toHaveBeenCalled();
    expect(api.watchDirectory).toHaveBeenCalledOnce();
  });

  it('keeps resume reconciliation when a filesystem event joins the pending batch', async () => {
    const props = options();
    renderHook(() => useDirectoryWatch(props));
    await flush();
    props.onChange.mockClear();
    props.onReconcile.mockClear();
    act(() => window.dispatchEvent(new Event('focus')));
    advance(200);
    act(() => listeners[0](event()));
    advance(400);
    expect(props.onChange).toHaveBeenCalledOnce();
    expect(props.onReconcile).toHaveBeenCalledOnce();
    expect(api.dispatchFileContentChanged).toHaveBeenCalledOnce();
    expect(api.dispatchFileContentChanged).toHaveBeenCalledWith('/Documents/file.txt');
  });

  it('cancels pending reconciliation and visibility listeners after unmount', async () => {
    const props = options();
    const { unmount } = renderHook(() => useDirectoryWatch(props));
    await flush();
    props.onChange.mockClear();
    props.onReconcile.mockClear();
    act(() => window.dispatchEvent(new Event('focus')));
    unmount();
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    advance(400);
    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onReconcile).not.toHaveBeenCalled();
    expect(api.unwatchDirectory).toHaveBeenCalledWith('watch-1');
    expect(api.dispatchFileContentChanged).not.toHaveBeenCalled();
  });

  it('supports callers without a reconciliation callback', async () => {
    const props = { ...options(), onReconcile: undefined };
    renderHook(() => useDirectoryWatch(props));
    await flush();
    expect(props.onChange).toHaveBeenCalledOnce();
    props.onChange.mockClear();
    act(() => window.dispatchEvent(new Event('focus')));
    advance(400);
    expect(props.onChange).toHaveBeenCalledOnce();
  });

  it('releases the listener on watch failure while retaining resume refresh', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    api.watchDirectory.mockRejectedValue(new Error('unavailable'));
    const props = options();
    renderHook(() => useDirectoryWatch(props));
    await flush();
    expect(unlisten).toHaveBeenCalledOnce();
    act(() => window.dispatchEvent(new Event('focus')));
    advance(400);
    expect(props.onChange).toHaveBeenCalledOnce();
    warning.mockRestore();
  });
});
