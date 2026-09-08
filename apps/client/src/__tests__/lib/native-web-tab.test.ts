import { describe, expect, it, vi } from 'vitest';
import { NativeWebTabSession } from '@/lib/native-web-tab';

const page = {
  active: true,
  url: 'https://baidu.com/',
  refresh: '0:0',
  bounds: { x: 10, y: 20, width: 600, height: 400 },
};
function setup(id = 'web') {
  const invoke = vi.fn().mockResolvedValue(undefined);
  const loading = vi.fn();
  const error = vi.fn();
  return { invoke, loading, error, session: new NativeWebTabSession(id, invoke, loading, error) };
}

describe('native web-tab lifecycle', () => {
  it('reuses one page through ten tab switches with no navigation or reload', async () => {
    const { session, invoke, loading } = setup();
    await session.sync(page);
    for (let i = 0; i < 10; i++) {
      await session.sync({ ...page, active: false });
      await session.sync(page);
    }
    expect(invoke.mock.calls.filter(([name]) => name === 'web_tab_create')).toHaveLength(1);
    expect(invoke.mock.calls.filter(([name]) => name === 'web_tab_visibility')).toHaveLength(20);
    expect(
      invoke.mock.calls.filter(([name]) => /navigate|reload|destroy|bounds/.test(name)),
    ).toHaveLength(0);
    expect(loading).toHaveBeenCalledTimes(1);
    await session.dispose();
    expect(invoke).toHaveBeenLastCalledWith('web_tab_destroy', { id: 'web' });
  });

  it('does not preload inactive tabs or zero-size panes', async () => {
    const { session, invoke } = setup();
    await session.sync({ ...page, active: false });
    await session.sync({ ...page, bounds: { ...page.bounds, width: 0 } });
    expect(invoke).not.toHaveBeenCalled();
    await session.sync(page);
    expect(invoke).toHaveBeenCalledTimes(1);
    await session.dispose();
  });

  it('navigates and explicitly refreshes without destroying the webview', async () => {
    const { session, invoke } = setup();
    await session.sync(page);
    await session.sync({ ...page, url: 'https://example.com/' });
    expect(invoke).toHaveBeenLastCalledWith('web_tab_navigate', {
      id: 'web',
      url: 'https://example.com/',
    });
    await session.sync({ ...page, url: 'https://example.com/', refresh: '1:0' });
    expect(invoke).toHaveBeenLastCalledWith('web_tab_reload', { id: 'web' });
    expect(invoke).toHaveBeenCalledTimes(3);
    await session.dispose();
  });

  it('deduplicates unchanged resize notifications and coalesces rapid updates', async () => {
    const { session, invoke } = setup();
    await session.sync(page);
    await session.sync(page);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        session.sync({ ...page, bounds: { ...page.bounds, width: 700 + i } }),
      ),
    );
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith('web_tab_bounds', {
      id: 'web',
      ...page.bounds,
      width: 719,
    });
    await session.dispose();
  });

  it('destroys a late create before a replacement instance is created', async () => {
    const { session, invoke } = setup();
    let finish!: () => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const creating = session.sync(page);
    await Promise.resolve();
    const closing = session.dispose();
    const replacement = new NativeWebTabSession('web', invoke, vi.fn(), vi.fn());
    const reopening = replacement.sync(page);
    finish();
    await Promise.all([creating, closing, reopening]);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'web_tab_create',
      'web_tab_destroy',
      'web_tab_create',
    ]);
    await replacement.dispose();
  });

  it('hides a page switched away while its create is still pending', async () => {
    const { session, invoke } = setup();
    let finish!: () => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const creating = session.sync(page);
    await Promise.resolve();
    const hiding = session.sync({ ...page, active: false });
    finish();
    await Promise.all([creating, hiding]);
    expect(invoke).toHaveBeenLastCalledWith('web_tab_visibility', { id: 'web', visible: false });
    await session.dispose();
  });

  it('reports creation errors and allows a real retry', async () => {
    const { session, invoke, error } = setup();
    invoke.mockRejectedValueOnce(new Error('create failed'));
    await session.sync(page);
    expect(error).toHaveBeenCalledTimes(1);
    await session.sync({ ...page, refresh: '0:1' });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'web_tab_create',
      'web_tab_create',
    ]);
    await session.dispose();
  });
});
