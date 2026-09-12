import { beforeEach, describe, expect, it, vi } from 'vitest';

const { setTheme, isTauri } = vi.hoisted(() => ({
  setTheme: vi.fn<(theme: 'light' | 'dark' | null) => Promise<void>>(),
  isTauri: vi.fn(() => true),
}));
vi.mock('@/lib/transport', () => ({ isTauri }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ setTheme }) }));

describe('native appearance bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    setTheme.mockReset().mockResolvedValue(undefined);
    isTauri.mockReturnValue(true);
    delete document.documentElement.dataset.nativeAppearance;
  });

  it('applies explicit choices and passes null for system, deduplicating successful preferences', async () => {
    const { syncNativeAppearance } = await import('@/lib/native-appearance');
    await syncNativeAppearance('dark');
    await syncNativeAppearance('dark');
    expect(setTheme.mock.calls).toEqual([['dark']]);
    expect(document.documentElement.dataset.nativeAppearance).toBe('dark');
    await syncNativeAppearance('light');
    await syncNativeAppearance('system');
    await syncNativeAppearance('system');
    expect(setTheme.mock.calls).toEqual([['dark'], ['light'], [null]]);
    expect(document.documentElement.dataset.nativeAppearance).toBe('system');
  });

  it('serializes rapid changes so the latest preference wins and only marks successful changes', async () => {
    let finishDark!: () => void;
    setTheme.mockImplementationOnce(() => new Promise<void>((resolve) => (finishDark = resolve)));
    const { syncNativeAppearance } = await import('@/lib/native-appearance');
    const pending = syncNativeAppearance('dark');
    await vi.waitFor(() => expect(setTheme).toHaveBeenCalledWith('dark'));
    expect(document.documentElement.dataset.nativeAppearance).toBeUndefined();
    void syncNativeAppearance('light');
    void syncNativeAppearance('system');
    expect(setTheme).toHaveBeenCalledTimes(1);
    finishDark();
    await pending;
    expect(setTheme.mock.calls).toEqual([['dark'], [null]]);
    expect(document.documentElement.dataset.nativeAppearance).toBe('system');
  });

  it('keeps failed changes unconfirmed and allows retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setTheme.mockRejectedValueOnce(new Error('Permission denied'));
    try {
      const { syncNativeAppearance } = await import('@/lib/native-appearance');
      await syncNativeAppearance('dark');
      expect(document.documentElement.dataset.nativeAppearance).toBeUndefined();
      await syncNativeAppearance('dark');
      expect(setTheme.mock.calls).toEqual([['dark'], ['dark']]);
      expect(document.documentElement.dataset.nativeAppearance).toBe('dark');
    } finally {
      warn.mockRestore();
    }
  });

  it('does not discard a newer request when the in-flight change fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let failDark!: (error: Error) => void;
    setTheme.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => (failDark = reject)),
    );
    try {
      const { syncNativeAppearance } = await import('@/lib/native-appearance');
      const pending = syncNativeAppearance('dark');
      await vi.waitFor(() => expect(setTheme).toHaveBeenCalledWith('dark'));
      void syncNativeAppearance('light');
      failDark(new Error('Temporary failure'));
      await pending;
      expect(setTheme.mock.calls).toEqual([['dark'], ['light']]);
      expect(document.documentElement.dataset.nativeAppearance).toBe('light');
    } finally {
      warn.mockRestore();
    }
  });

  it('does not invoke native APIs in a browser', async () => {
    isTauri.mockReturnValue(false);
    const { syncNativeAppearance } = await import('@/lib/native-appearance');
    await syncNativeAppearance('dark');
    expect(setTheme).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.nativeAppearance).toBeUndefined();
  });
});
