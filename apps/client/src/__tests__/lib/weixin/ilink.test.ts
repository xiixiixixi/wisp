/**
 * 微信桥纯函数 + 二维码本地渲染测试（无网络）。
 */
import { describe, it, expect, vi } from 'vitest';
import { normalizeInbound, IlinkChannel } from '@/lib/weixin/ilink';

const transportMock = vi.fn();
vi.mock('@/lib/transport', () => ({
  isTauri: () => false,
  transport: (...args: unknown[]) => transportMock(...args),
}));

describe('normalizeInbound', () => {
  it('normalizes a direct text message', () => {
    const m = normalizeInbound({
      message_type: 1,
      from_user_id: 'u1',
      item_list: [{ text_item: { text: '帮我归档下载文件夹' } }],
      context_token: 'ctx-1',
    });
    expect(m).toEqual({
      fromUserId: 'u1',
      groupId: undefined,
      text: '帮我归档下载文件夹',
      mediaNote: undefined,
      contextToken: 'ctx-1',
    });
  });

  it('keeps group id and merges voice transcripts', () => {
    const m = normalizeInbound({
      message_type: 1,
      from_user_id: 'u2',
      group_id: 'g1',
      item_list: [{ voice_item: { text: '语音转的文字' } }, { text_item: { text: '加一段文字' } }],
    });
    expect(m?.groupId).toBe('g1');
    expect(m?.text).toBe('语音转的文字\n加一段文字');
  });

  it('marks media-only messages with a note', () => {
    const m = normalizeInbound({
      message_type: 1,
      from_user_id: 'u3',
      item_list: [{ image_item: {} }],
    });
    expect(m?.text).toBe('');
    expect(m?.mediaNote).toBe('[图片]');
  });

  it('drops bot/system messages and empties', () => {
    expect(normalizeInbound({ message_type: 2, from_user_id: 'u' })).toBeUndefined();
    expect(normalizeInbound({ message_type: 1, from_user_id: '' })).toBeUndefined();
    expect(normalizeInbound({ message_type: 1, from_user_id: 'u', item_list: [] })).toBeUndefined();
  });
});

describe('IlinkChannel.startLogin', () => {
  it('renders the QR locally as a data URL from the link string', async () => {
    transportMock.mockResolvedValueOnce({
      status: 200,
      body: {
        qrcode: '5c32335151d97f8cb503301e43869388',
        qrcode_img_content: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=abc&bot_type=3',
        ret: 0,
      },
    });
    const ch = new IlinkChannel();
    const qr = await ch.startLogin();
    expect(qr.startsWith('data:image/png;base64,')).toBe(true);
    expect(qr.length).toBeGreaterThan(500);
  });
});
