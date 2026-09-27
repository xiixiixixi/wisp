/**
 * 微信官方 iLink 机器人通道（clawbot）——Wisp 移植版。
 *
 * 移植自 dsh-weixin-clawbot（MIT，github.com/xiixiixixi/dsh-weixin-clawbot）
 * 的 src/ilink.ts，协议不变：
 *  - get_bot_qrcode 出配对二维码 → 手机扫码 → 手机显示数字 → 提交配对码
 *  - confirmed 返回 {token, botId, userId, baseUrl}（凭据经 Rust 落盘 600）
 *  - getupdates 长轮询收消息（游标 get_updates_buf；errcode -14 = 会话失效）
 *  - sendmessage 发回复（携带 context_token）
 * 差异仅两点：fetch → Rust HTTP 代理（WKWebView 跨域限制，仅放行
 * *.weixin.qq.com）；fs → weixin_creds_* 命令（app_data_dir）。
 */
import { transport, isTauri } from '@/lib/transport';

export const ILINK_LOGIN_BASE_URL = 'https://ilinkai.weixin.qq.com';

export interface IlinkCredentials {
  token: string;
  botId: string;
  userId: string;
  baseUrl: string;
}

export type IlinkLoginTick =
  | { kind: 'wait' }
  | { kind: 'scaned' }
  | { kind: 'expired' }
  | { kind: 'need-verifycode'; wrongCode?: boolean }
  | { kind: 'verify-code-blocked' }
  | { kind: 'binded' }
  | { kind: 'confirmed'; credentials: IlinkCredentials };

export interface IlinkInboundMessage {
  fromUserId: string;
  groupId?: string;
  text: string;
  mediaNote?: string;
  contextToken?: string;
}

// ── HTTP（经 Rust 代理） ─────────────────────────────────────────────────────

interface ProxyResponse {
  status: number;
  body: unknown;
}

const httpRequest = async (
  url: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body?: unknown,
): Promise<unknown> => {
  const resp = await transport<ProxyResponse>('weixin_http', {
    url,
    method,
    headers,
    body: body ?? null,
  });
  if (resp.status >= 400) {
    throw new Error(`HTTP ${resp.status}: ${JSON.stringify(resp.body).slice(0, 160)}`);
  }
  return resp.body;
};

// webview 无 node:crypto —— 随机 UIN 用 WebCrypto 掷 4 字节。
const randomUin = (): string => {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
};

const buildHeaders = (token: string | undefined): Record<string, string> => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'iLink-App-Id': 'bot',
    'iLink-App-ClientVersion': '65536',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomUin(),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

const normalizeBaseUrl = (raw: string | undefined): string | undefined => {
  if (typeof raw !== 'string' || raw === '') return undefined;
  const withScheme = raw.startsWith('http') ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, '');
};

// ── 凭据（经 Rust 落盘） ─────────────────────────────────────────────────────

export const loadCredentials = async (): Promise<IlinkCredentials | undefined> => {
  if (!isTauri()) return undefined;
  try {
    const creds = await transport<IlinkCredentials | null>('weixin_creds_get');
    return creds && typeof creds.token === 'string' && creds.token ? creds : undefined;
  } catch {
    return undefined;
  }
};

const saveCredentials = (creds: IlinkCredentials) =>
  transport('weixin_creds_set', { creds }).catch(() => undefined);

// ── 通道客户端 ───────────────────────────────────────────────────────────────

export class IlinkChannel {
  private qrCode?: string;
  private qrUrl?: string;
  private pendingVerifyCode?: string;
  private lastNeededVerifyCode = false;
  private updatesBuf = '';
  private running = false;
  private credentials?: IlinkCredentials;

  constructor(private readonly log: (m: string) => void = () => {}) {}

  savedCredentials(): IlinkCredentials | undefined {
    return this.credentials;
  }

  async restore(): Promise<boolean> {
    this.credentials = await loadCredentials();
    return this.credentials !== undefined;
  }

  /** 发起扫码登录，返回二维码内容（img 渲染用）。 */
  async startLogin(): Promise<string> {
    const body = (await httpRequest(
      `${ILINK_LOGIN_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`,
      'POST',
      buildHeaders(undefined),
      { local_token_list: this.credentials ? [this.credentials.token] : [] },
    )) as { qrcode?: string; qrcode_img_content?: string };
    if (typeof body.qrcode !== 'string' || typeof body.qrcode_img_content !== 'string') {
      throw new Error(`get_bot_qrcode 响应异常: ${JSON.stringify(body).slice(0, 160)}`);
    }
    this.qrCode = body.qrcode;
    this.pendingVerifyCode = undefined;
    this.lastNeededVerifyCode = false;
    // 照 dsh backend.renderQrPng：二维码本地渲染——qrcode_img_content 是
    // 二维码里编码的链接（手机浏览器打开用的落地页），不是图片本身。
    const QRCode = (await import('qrcode')).default;
    this.qrUrl = await QRCode.toDataURL(body.qrcode_img_content, { margin: 1, width: 480 });
    this.log('[weixin] 二维码已生成（本地渲染）');
    return this.qrUrl;
  }

  currentQrUrl(): string | undefined {
    return this.qrUrl;
  }

  submitVerifyCode(code: string): void {
    this.pendingVerifyCode = code.trim();
  }

  /** 登录轮询推进一拍（配对页每 3s 调一次）。 */
  async pollLoginOnce(): Promise<IlinkLoginTick> {
    if (this.qrCode === undefined) return { kind: 'wait' };
    const params = new URLSearchParams({ qrcode: this.qrCode });
    if (this.pendingVerifyCode) params.set('verify_code', this.pendingVerifyCode);
    let parsed: Record<string, unknown>;
    try {
      parsed = (await httpRequest(
        `${ILINK_LOGIN_BASE_URL}/ilink/bot/get_qrcode_status?${params.toString()}`,
        'GET',
        buildHeaders(undefined),
      )) as Record<string, unknown>;
    } catch (e) {
      this.log(`[weixin] 登录轮询失败（重试）: ${String(e)}`);
      return { kind: 'wait' };
    }
    switch (parsed.status) {
      case 'wait':
        return { kind: 'wait' };
      case 'scaned':
        this.pendingVerifyCode = undefined;
        this.lastNeededVerifyCode = false;
        return { kind: 'scaned' };
      case 'need_verifycode': {
        const wrong = this.lastNeededVerifyCode;
        this.lastNeededVerifyCode = true;
        return { kind: 'need-verifycode', wrongCode: wrong };
      }
      case 'verify_code_blocked':
        this.pendingVerifyCode = undefined;
        this.lastNeededVerifyCode = false;
        return { kind: 'verify-code-blocked' };
      case 'expired':
        return { kind: 'expired' };
      case 'binded_redirect':
        return { kind: 'binded' };
      case 'scaned_but_redirect':
        return { kind: 'scaned' };
      case 'confirmed': {
        const botId = parsed.ilink_bot_id;
        if (typeof botId !== 'string' || !botId) return { kind: 'expired' };
        const credentials: IlinkCredentials = {
          token: typeof parsed.bot_token === 'string' ? parsed.bot_token : '',
          botId,
          userId: typeof parsed.ilink_user_id === 'string' ? parsed.ilink_user_id : '',
          baseUrl: normalizeBaseUrl(parsed.baseurl as string) ?? ILINK_LOGIN_BASE_URL,
        };
        this.credentials = credentials;
        await saveCredentials(credentials);
        this.qrCode = undefined;
        this.qrUrl = undefined;
        this.log(`[weixin] 登录成功（bot: ${credentials.botId}）`);
        return { kind: 'confirmed', credentials };
      }
      default:
        return { kind: 'wait' };
    }
  }

  async logout(): Promise<void> {
    this.stop();
    this.credentials = undefined;
    this.updatesBuf = '';
    await transport('weixin_creds_clear').catch(() => undefined);
    this.log('[weixin] 已解绑（凭据已清除）');
  }

  /** 消息长轮询一拍：返回本轮收到的消息（调用方循环驱动）。 */
  async pollUpdatesOnce(): Promise<IlinkInboundMessage[]> {
    const creds = this.credentials;
    if (!creds) throw new Error('iLink 未登录');
    this.running = true;
    const response = (await httpRequest(
      `${creds.baseUrl}/ilink/bot/getupdates`,
      'POST',
      buildHeaders(creds.token),
      { get_updates_buf: this.updatesBuf, base_info: { bot_agent: 'Wisp-Weixin' } },
    )) as {
      ret?: number;
      errcode?: number;
      errmsg?: string;
      msgs?: Array<Record<string, unknown>>;
      get_updates_buf?: string;
    };
    if (response.errcode === -14) {
      this.running = false;
      this.credentials = undefined;
      throw new Error('session-expired');
    }
    if (typeof response.get_updates_buf === 'string' && response.get_updates_buf !== '') {
      this.updatesBuf = response.get_updates_buf;
    }
    const raw = response.msgs ?? [];
    if (raw.length > 0) {
      // 原始信封先留证：解析对不上形状时靠这个对症下药
      this.log(`[weixin] 收到 ${raw.length} 条原始消息，首条：${JSON.stringify(raw[0]).slice(0, 300)}`);
    }
    return raw
      .map((m) => normalizeInbound(m))
      .filter((m): m is IlinkInboundMessage => m !== undefined);
  }

  /** 启动握手（消息路由建立，失败不阻断）。 */
  async notifyStart(): Promise<void> {
    const creds = this.credentials;
    if (!creds) return;
    try {
      await httpRequest(
        `${creds.baseUrl}/ilink/bot/msg/notifystart`,
        'POST',
        buildHeaders(creds.token),
        { base_info: { bot_agent: 'Wisp-Weixin' } },
      );
    } catch (e) {
      this.log(`[weixin] notifyStart 失败（忽略）: ${String(e)}`);
    }
  }

  stop(): void {
    const creds = this.credentials;
    if (this.running && creds) {
      void httpRequest(
        `${creds.baseUrl}/ilink/bot/msg/notifystop`,
        'POST',
        buildHeaders(creds.token),
        { base_info: { bot_agent: 'Wisp-Weixin' } },
      ).catch(() => undefined);
    }
    this.running = false;
  }

  async sendText(toUserId: string, text: string, contextToken?: string): Promise<void> {
    const creds = this.credentials;
    if (!creds) throw new Error('iLink 未登录，无法发送消息');
    const response = (await httpRequest(
      `${creds.baseUrl}/ilink/bot/sendmessage`,
      'POST',
      buildHeaders(creds.token),
      {
        msg: {
          from_user_id: '',
          to_user_id: toUserId,
          client_id: `wisp-weixin-${crypto.randomUUID()}`,
          message_type: 2,
          message_state: 2,
          item_list: text ? [{ type: 1, text_item: { text } }] : undefined,
          context_token: contextToken ?? undefined,
        },
      },
    )) as { ret?: number; errmsg?: string };
    if (response.ret !== 0 && response.ret !== undefined) {
      throw new Error(`sendmessage 失败: ret=${response.ret} ${response.errmsg ?? ''}`);
    }
  }
}

/** 入站消息归一化（与 dsh 插件同款：文本+语音转文字合并，媒体摘要）。 */
export const normalizeInbound = (
  msg: Record<string, unknown>,
): IlinkInboundMessage | undefined => {
  if (msg.message_type !== 1) return undefined;
  const fromUserId = typeof msg.from_user_id === 'string' ? msg.from_user_id : '';
  if (!fromUserId) return undefined;
  const groupId =
    typeof msg.group_id === 'string' && msg.group_id !== '' ? msg.group_id : undefined;

  const parts: string[] = [];
  let mediaNote: string | undefined;
  const items = Array.isArray(msg.item_list)
    ? (msg.item_list as Array<Record<string, unknown>>)
    : [];
  for (const item of items) {
    const text = (item.text_item as { text?: string } | undefined)?.text;
    if (typeof text === 'string' && text !== '') parts.push(text);
    const voiceText = (item.voice_item as { text?: string } | undefined)?.text;
    if (typeof voiceText === 'string' && voiceText !== '') parts.push(voiceText);
    if (item.image_item) mediaNote = '[图片]';
    else if (item.video_item) mediaNote = '[视频]';
    else if (item.file_item) {
      const name = (item.file_item as { file_name?: string }).file_name;
      mediaNote = `[文件${typeof name === 'string' && name ? `: ${name}` : ''}]`;
    }
  }
  const text = parts.join('\n');
  if (text === '' && mediaNote === undefined) return undefined;
  return {
    fromUserId,
    groupId,
    text,
    mediaNote,
    contextToken: typeof msg.context_token === 'string' ? msg.context_token : undefined,
  };
};
