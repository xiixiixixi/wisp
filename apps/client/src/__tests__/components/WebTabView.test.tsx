import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import WebTabView from '@/components/web/WebTabView';
import WebTabDeck from '@/components/web/WebTabDeck';
const mocks = vi.hoisted(() => ({
  native: vi.fn(() => false),
  invoke: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('@/lib/transport', () => ({ isTauri: mocks.native }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
beforeEach(() => {
  mocks.invoke.mockResolvedValue(undefined);
  mocks.listen.mockResolvedValue(mocks.stop);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  cleanup();
  await act(async () => {});
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.native.mockReturnValue(false);
});
const bounds = () =>
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    top: 20,
    width: 600,
    height: 400,
  } as DOMRect);

describe('web tab browser preview', () => {
  it('loads the website immediately instead of displaying a desktop-only message', () => {
    render(<WebTabView tabId="web" url="https://baidu.com/" />);
    const frame = screen.getByTitle('Web page: baidu.com');
    expect(frame).toHaveAttribute('src', 'https://baidu.com/');
    expect(frame).toHaveAttribute('loading', 'eager');
    expect(frame).toHaveAttribute('sandbox', expect.not.stringContaining('allow-top-navigation'));
    expect(screen.queryByText(/Embedded websites are available/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in browser' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.load(frame);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('keeps the exact iframe node when switching away and back', () => {
    const tabs = [
      { id: 'web', name: 'Web', path: 'https://baidu.com/', type: 'web' as const },
      { id: 'folder', name: 'Documents', path: '/Documents', type: 'folder' as const },
      { id: 'background', name: 'Other', path: 'https://example.com/', type: 'web' as const },
    ];
    const { rerender } = render(<WebTabDeck tabs={tabs} activeTabId="web" refreshTokens={{}} />);
    const frame = screen.getByTitle('Web page: baidu.com');
    expect(screen.queryByTitle('Web page: example.com')).not.toBeInTheDocument();
    rerender(<WebTabDeck tabs={tabs} activeTabId="folder" refreshTokens={{}} />);
    expect(frame).toBeInTheDocument();
    expect(frame.closest('[aria-hidden]')).toHaveAttribute('aria-hidden', 'true');
    rerender(<WebTabDeck tabs={tabs} activeTabId="web" refreshTokens={{}} />);
    expect(screen.getByTitle('Web page: baidu.com')).toBe(frame);
    rerender(<WebTabDeck tabs={tabs.slice(1)} activeTabId="folder" refreshTokens={{}} />);
    expect(frame).not.toBeInTheDocument();
  });

  it('only replaces an iframe when explicitly refreshed or navigated', () => {
    const { rerender } = render(<WebTabView tabId="web" url="https://baidu.com/" />);
    const original = screen.getByTitle('Web page: baidu.com');
    rerender(<WebTabView tabId="web" url="https://baidu.com/" refreshToken={1} />);
    expect(screen.getByTitle('Web page: baidu.com')).not.toBe(original);
    rerender(<WebTabView tabId="web" url="https://example.com/" refreshToken={1} />);
    expect(screen.getByTitle('Web page: example.com')).toHaveAttribute(
      'src',
      'https://example.com/',
    );
  });

  it('offers a non-blocking retry after a slow load and clears it on load', () => {
    vi.useFakeTimers();
    render(<WebTabView tabId="web" url="https://baidu.com/" />);
    const frame = screen.getByTitle('Web page: baidu.com');
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Still loading');
    expect(frame).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading page' }));
    const retry = screen.getByTitle('Web page: baidu.com');
    expect(retry).not.toBe(frame);
    expect(screen.getByRole('status')).toHaveTextContent('Loading page');
    fireEvent.load(retry);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Retry loading page' })).not.toBeInTheDocument();
  });
});

describe('native web tab integration', () => {
  it('can retry a failed load-event subscription', async () => {
    mocks.native.mockReturnValue(true);
    bounds();
    mocks.listen.mockRejectedValueOnce(new Error('event registration failed'));
    render(<WebTabView tabId="native-listener-retry" url="https://baidu.com/" />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not load'));
    expect(mocks.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading page' }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        'web_tab_create',
        expect.objectContaining({ id: 'native-listener-retry' }),
      ),
    );
    expect(mocks.listen).toHaveBeenCalledTimes(2);
  });

  it('subscribes before creating, uses real load events, and cleans up on close', async () => {
    mocks.native.mockReturnValue(true);
    bounds();
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<WebTabView tabId="native-web" url="https://baidu.com/" />);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('web_tab_create', {
        id: 'native-web',
        url: 'https://baidu.com/',
        x: 10,
        y: 20,
        width: 600,
        height: 400,
      }),
    );
    expect(mocks.listen.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.invoke.mock.invocationCallOrder[0],
    );
    const listener = mocks.listen.mock.calls[0][1];
    act(() => listener({ payload: { id: 'other', loading: false } }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading page');
    act(() => listener({ payload: { id: 'native-web', loading: false } }));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    const resize = add.mock.calls.find(([name]) => name === 'resize')?.[1];
    unmount();
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('web_tab_destroy', { id: 'native-web' }),
    );
    expect(remove).toHaveBeenCalledWith('resize', resize);
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it('hides and reveals a native tab instead of recreating it', async () => {
    mocks.native.mockReturnValue(true);
    bounds();
    const { rerender } = render(<WebTabView tabId="native-switch" url="https://baidu.com/" />);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    rerender(<WebTabView tabId="native-switch" url="https://baidu.com/" active={false} />);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenLastCalledWith('web_tab_visibility', {
        id: 'native-switch',
        visible: false,
      }),
    );
    rerender(<WebTabView tabId="native-switch" url="https://baidu.com/" />);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenLastCalledWith('web_tab_visibility', {
        id: 'native-switch',
        visible: true,
      }),
    );
    expect(mocks.invoke.mock.calls.filter(([name]) => name === 'web_tab_create')).toHaveLength(1);
    expect(mocks.invoke.mock.calls.filter(([name]) => name === 'web_tab_destroy')).toHaveLength(0);
  });

  it('does not leak a native webview when unmounted before listener registration finishes', async () => {
    mocks.native.mockReturnValue(true);
    bounds();
    let finish!: (stop: () => void) => void;
    mocks.listen.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { unmount } = render(<WebTabView tabId="native-race" url="https://baidu.com/" />);
    unmount();
    await act(async () => {
      finish(mocks.stop);
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it('reports native creation errors and retries rather than swallowing them', async () => {
    mocks.native.mockReturnValue(true);
    bounds();
    mocks.invoke.mockRejectedValueOnce(new Error('create failed'));
    render(<WebTabView tabId="native-error" url="https://baidu.com/" />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not load'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading page' }));
    await waitFor(() =>
      expect(mocks.invoke.mock.calls.filter(([name]) => name === 'web_tab_create')).toHaveLength(2),
    );
  });
});
