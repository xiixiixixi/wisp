import { beforeEach, expect, it, vi } from 'vitest';
import { weixinBridge } from '@/lib/weixin/bridge';
import { transport } from '@/lib/transport';
vi.mock('@/lib/transport', () => ({ isTauri: () => true, transport: vi.fn() }));
vi.mock('@/lib/pi-engine/engine', () => ({ PiEngine: class {} }));
vi.mock('@/lib/pi-engine/providers', () => ({
  availableModels: vi.fn(),
  migrateLegacyProviderKeys: vi.fn(),
}));
vi.mock('@/lib/weixin/ilink', () => ({ IlinkChannel: class {} }));
beforeEach(() => vi.clearAllMocks());
it('keeps saved folder restrictions on write failure and accepts a later retry', async () => {
  vi.mocked(transport).mockResolvedValue(undefined);
  await weixinBridge.setPersisted({ folders: ['/safe'] });
  vi.mocked(transport).mockRejectedValueOnce(new Error('Disk full'));
  await expect(weixinBridge.setPersisted({ folders: [] })).rejects.toThrow('Disk full');
  expect(weixinBridge.getPersisted().folders).toEqual(['/safe']);
  await weixinBridge.setPersisted({ replyOn: 'turn' });
  expect(weixinBridge.getPersisted()).toMatchObject({ folders: ['/safe'], replyOn: 'turn' });
});
it('serializes independent setting edits and merges against the last committed state', async () => {
  let finish!: () => void;
  vi.mocked(transport)
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const first = weixinBridge.setPersisted({ folders: ['/new'] });
  const second = weixinBridge.setPersisted({ noticeTools: false });
  await Promise.resolve();
  expect(transport).toHaveBeenCalledTimes(1);
  finish();
  await Promise.all([first, second]);
  expect(vi.mocked(transport).mock.calls[1][1]).toMatchObject({
    state: { folders: ['/new'], noticeTools: false },
  });
});
