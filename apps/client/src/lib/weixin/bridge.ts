/**
 * 微信桥编排器（模块级单例，不随面板卸载而停）。
 *
 * 对齐 dsh-weixin-clawbot 的设计（照抄不发挥）：
 *  - 会话路由：微信主体（私聊用户/群）→ 稳定记录 {folder, sessionId}，
 *    重启后凭 sessionId 续接历史（pi_session_read resume）；
 *  - 命令：/new /stop /status /ws（列表+切换）/help（/cd 为别名）；
 *  - 回复颗粒度：replyOn step/turn + noticeTools（⚙️ 工具提示）；
 *  - 写操作审批转发微信（允许/拒绝，90s 超时拒绝）。
 */
import { IlinkChannel, type IlinkInboundMessage } from './ilink';
import { PiEngine, type ApprovalDecision } from '@/lib/pi-engine/engine';
import { availableModels, migrateLegacyProviderKeys } from '@/lib/pi-engine/providers';
import { transport, isTauri } from '@/lib/transport';

export type BridgeStatus =
  | 'idle'
  | 'qr'
  | 'need-code'
  | 'connecting'
  | 'connected'
  | 'expired'
  | 'error';

export interface BridgeState {
  status: BridgeStatus;
  qrUrl?: string;
  error?: string;
  botId?: string;
}

interface SubjectRuntime {
  folder: string;
  engine?: PiEngine;
  sessionId?: string;
  busy: boolean;
  approvalResolve?: (d: ApprovalDecision) => void;
  /** 最近一次入站的回复目标/上下文（审批提示发到这）。 */
  lastTo?: string;
  lastContextToken?: string;
}

/** 落盘状态（照 dsh 插件 state.json 语义：颗粒度 + 范围 + 主体路由）。 */
export interface PersistedState {
  folders: string[];
  dmPolicy: 'open' | 'allowlist';
  allowFrom: string[];
  /** step = 每回合文本；turn = 仅摘要（回合结果）。 */
  replyOn: 'step' | 'turn';
  /** 工具调用提示（颗粒度=完整 时为 true）。 */
  noticeTools: boolean;
  /** 主体 → {folder, sessionId}，重启续接用。 */
  subjects: Record<string, { folder: string; sessionId: string }>;
}

const TEXT_CHUNK_LIMIT = 3800;
const APPROVAL_TIMEOUT_MS = 90_000;
const DEFAULT_PERSISTED: PersistedState = {
  folders: [],
  dmPolicy: 'open',
  allowFrom: [],
  replyOn: 'step',
  noticeTools: true,
  subjects: {},
};

const subjectKey = (m: IlinkInboundMessage) =>
  m.groupId ? `group:${m.groupId}:${m.fromUserId}` : `direct:${m.fromUserId}`;

class WeixinBridge {
  private channel = new IlinkChannel((m) => this.pushLog(m));
  private subjects = new Map<string, SubjectRuntime>();
  private persisted: PersistedState = { ...DEFAULT_PERSISTED, subjects: {} };
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private loginTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private logs: string[] = [];
  private unlistenAgentEvent?: () => void;
  /** 连续过期计数（人工点刷新时清零）。 */
  private expiredCount = 0;

  state: BridgeState = { status: 'idle' };

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  private pushLog(m: string) {
    this.logs = [...this.logs.slice(-40), `${new Date().toLocaleTimeString()} ${m}`];
    this.emit();
    if (isTauri()) {
      void transport('weixin_log', { line: m }).catch(() => undefined);
    }
  }

  getLogs(): string[] {
    return this.logs;
  }

  getPersisted(): PersistedState {
    return this.persisted;
  }

  private persistQueue: Promise<void> = Promise.resolve();

  setPersisted(next: Partial<PersistedState>): Promise<void> {
    const save = this.persistQueue.then(async () => {
      const state = { ...this.persisted, ...next };
      if (isTauri()) await transport('weixin_state_set', { state });
      this.persisted = state;
      this.emit();
    });
    // A failed write must keep the previous settings and allow a later retry.
    this.persistQueue = save.catch(() => undefined);
    return save;
  }

  /** 应用启动时调用：恢复状态与凭据，已绑定则直接进入消息循环。 */
  async init(): Promise<void> {
    if (!isTauri()) return;
    this.pushLog('[weixin] 桥初始化…');
    try {
      const saved = await transport<PersistedState | null>('weixin_state_get');
      if (saved && Array.isArray(saved.folders)) {
        this.persisted = { ...DEFAULT_PERSISTED, ...saved };
      }
    } catch {
      // 状态读取失败用默认值
    }
    // 主体路由表 → 运行时（含重启续接的 sessionId）
    for (const [key, info] of Object.entries(this.persisted.subjects ?? {})) {
      this.subjects.set(key, { folder: info.folder, sessionId: info.sessionId, busy: false });
    }
    // 工具提示：订阅 agent-event（与本地面板同源）
    if (!this.unlistenAgentEvent) {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        this.unlistenAgentEvent = await listen<{
          session_id: string;
          event_type: string;
          tool_call?: { name?: string };
        }>('agent-event', (event) => {
          if (!this.persisted.noticeTools) return;
          const payload = event.payload;
          if (!payload || payload.event_type !== 'tool_call') return;
          const entry = [...this.subjects.entries()].find(
            ([, rt]) => rt.sessionId === payload.session_id,
          );
          if (!entry) return;
          const rt = entry[1];
          if (rt.lastTo) {
            void this.channel
              .sendText(rt.lastTo, `⚙️ ${payload.tool_call?.name ?? '工具'}…`, rt.lastContextToken)
              .catch(() => undefined);
          }
        });
      } catch {
        // 事件不可用则无工具提示
      }
    }
    if (await this.channel.restore()) {
      await this.startMessageLoop();
      this.pushLog('[weixin] 凭据恢复，已自动重连（重启免扫码）');
    }
  }

  // ── 登录流（面板驱动） ─────────────────────────────────────────

  async beginPairing(): Promise<void> {
    this.expiredCount = 0;
    this.pushLog('[weixin] 发起配对请求（get_bot_qrcode）…');
    try {
      const qrUrl = await this.channel.startLogin();
      this.state = { status: 'qr', qrUrl };
      this.emit();
      this.scheduleLoginPoll();
    } catch (e) {
      this.pushLog(`[weixin] 配对发起失败: ${String(e).slice(0, 200)}`);
      this.state = { status: 'error', error: String(e) };
      this.emit();
    }
  }

  submitVerifyCode(code: string): void {
    this.channel.submitVerifyCode(code);
    if (this.state.status === 'need-code') {
      this.state = { status: 'connecting' };
      this.emit();
    }
  }

  private scheduleLoginPoll() {
    if (this.loginTimer) clearTimeout(this.loginTimer);
    this.loginTimer = setTimeout(() => void this.loginTick(), 3000);
  }

  private async loginTick(): Promise<void> {
    if (this.state.status !== 'qr' && this.state.status !== 'connecting') return;
    const tick = await this.channel.pollLoginOnce();
    switch (tick.kind) {
      case 'need-verifycode':
        this.state = { status: 'need-code', qrUrl: this.channel.currentQrUrl() };
        break;
      case 'expired': {
        // 照 dsh（ILINK_QR_REFRESH_LIMIT=5）+ 微信桌面版：过期自动换新，
        // 连续 5 次没人扫则暂停，等人工点刷新（防无人值守无限刷接口）。
        this.expiredCount += 1;
        if (this.expiredCount > 5) {
          this.pushLog('[weixin] 二维码多次过期，暂停自动刷新——打开面板点刷新重试');
          this.state = { status: 'expired' };
          this.emit();
          return;
        }
        this.pushLog(`[weixin] 二维码已过期，自动换新（${this.expiredCount}/5）`);
        this.state = { status: 'qr' };
        this.emit();
        setTimeout(() => void this.beginPairing(), 1200);
        return;
      }
      case 'confirmed': {
        this.state = { status: 'connected', botId: tick.credentials.botId };
        this.emit();
        await this.startMessageLoop();
        // 欢迎消息：立刻验证出站路径，也让你在微信里第一时间看到"连上了"
        const userId = tick.credentials.userId;
        if (userId) {
          await this.channel
            .sendText(
              userId,
              '✅ Wisp 微信遥控已连接。直接发消息对话 AI；/help 查看命令，/ws 切换文件夹。写操作会来微信请你批准。',
            )
            .catch((e) => this.pushLog(`[weixin] 欢迎消息发送失败: ${String(e).slice(0, 120)}`));
          this.pushLog('[weixin] 已发送欢迎消息');
        }
        return;
      }
      default:
        break;
    }
    this.emit();
    this.scheduleLoginPoll();
  }

  async unbind(): Promise<void> {
    this.stopLoops();
    await this.channel.logout();
    this.subjects.clear();
    this.state = { status: 'idle' };
    this.emit();
  }

  // ── 消息循环 ───────────────────────────────────────────────────

  private stopLoops() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.loginTimer) clearTimeout(this.loginTimer);
    this.pollTimer = null;
    this.loginTimer = null;
    this.channel.stop();
  }

  private async startMessageLoop(): Promise<void> {
    await this.channel.notifyStart();
    this.state = { status: 'connected', botId: this.channel.savedCredentials()?.botId };
    this.emit();
    this.pushLog('[weixin] 消息循环已启动');
    const loop = async () => {
      if (this.state.status !== 'connected') return;
      try {
        const msgs = await this.channel.pollUpdatesOnce();
        for (const m of msgs) {
          void this.handleInbound(m).catch((e) => this.pushLog(`[weixin] 处理消息失败: ${e}`));
        }
      } catch (e) {
        if (String(e).includes('session-expired')) {
          this.state = { status: 'expired', error: '会话失效，请重新扫码' };
          this.emit();
          return;
        }
        this.pushLog(`[weixin] getupdates 失败（3s 重试）: ${e}`);
      }
      if (this.state.status === 'connected') {
        this.pollTimer = setTimeout(() => void loop(), 1500);
      }
    };
    void loop();
  }

  // ── 入站处理 ───────────────────────────────────────────────────

  private async handleInbound(m: IlinkInboundMessage): Promise<void> {
    const key = subjectKey(m);
    const rt = this.subjects.get(key) ?? { folder: this.persisted.folders[0] ?? '/', busy: false };
    rt.lastTo = m.groupId ?? m.fromUserId;
    rt.lastContextToken = m.contextToken;
    this.subjects.set(key, rt);

    // 审批等待中的「允许/拒绝」优先于一切
    if (rt.approvalResolve) {
      const t = m.text.trim();
      if (/^(允许|allow|是|y|yes)$/i.test(t)) {
        rt.approvalResolve('allow_once');
        rt.approvalResolve = undefined;
        return;
      }
      if (/^(拒绝|deny|否|n|no)$/i.test(t)) {
        rt.approvalResolve('deny');
        rt.approvalResolve = undefined;
        return;
      }
      await this.reply(m, '🔒 有操作等待批准：请先回复「允许」或「拒绝」');
      return;
    }

    const text = (m.text + (m.mediaNote ? `\n${m.mediaNote}` : '')).trim();
    if (!text) return;

    if (text.startsWith('/')) {
      await this.handleCommand(m, key, rt, text);
      return;
    }
    if (rt.busy) {
      await this.reply(m, '⏳ 上一条还在处理，/stop 可中止');
      return;
    }
    if (
      this.persisted.dmPolicy === 'allowlist' &&
      !this.persisted.allowFrom.includes(m.fromUserId)
    ) {
      return; // 白名单外静默丢弃
    }
    rt.busy = true;
    try {
      const engine = await this.ensureEngine(key, rt);
      const final = await engine.prompt(text);
      await this.reply(m, final || '（完成，无文本输出）');
    } catch (e) {
      await this.reply(m, `❌ 出错了：${String(e).slice(0, 200)}`);
    } finally {
      rt.busy = false;
    }
  }

  /** 照 dsh 插件的命令集：/new /stop /status /ws /help（/cd 为别名）。 */
  private async handleCommand(
    m: IlinkInboundMessage,
    key: string,
    rt: SubjectRuntime,
    text: string,
  ): Promise<void> {
    const [rawCmd, ...rest] = text.slice(1).split(/\s+/);
    const cmd = (rawCmd ?? '').toLowerCase();
    switch (cmd) {
      case 'help':
        await this.reply(
          m,
          [
            'Wisp 微信遥控 · 命令：',
            '/new — 结束当前会话，下条消息开新篇',
            '/stop — 中止当前运行中的任务',
            '/status — 会话状态（含当前文件夹）',
            '/ws — 列出可用文件夹；/ws 2 按序号、/ws 路径 按名称切换',
            '/help — 本帮助',
            '其余消息直接对话 AI（写操作会来微信要批准）。',
          ].join('\n'),
        );
        break;
      case 'status':
        await this.reply(
          m,
          `状态：${this.state.status === 'connected' ? '已连接' : this.state.status}\n当前文件夹：${rt.folder}\n会话：${rt.sessionId ?? '新会话'}\n回复颗粒度：${this.persisted.replyOn === 'step' ? (this.persisted.noticeTools ? '完整' : '标准') : '摘要'}`,
        );
        break;
      case 'new':
        rt.engine?.abort();
        rt.engine = undefined;
        rt.sessionId = undefined;
        await this.saveSubject(key, rt);
        await this.reply(m, '✅ 已开新会话');
        break;
      case 'stop':
        if (rt.engine && rt.busy) {
          rt.engine.abort();
          rt.busy = false;
          await this.reply(m, '🛑 已中止');
        } else {
          await this.reply(m, '当前没有运行中的任务');
        }
        break;
      case 'ws':
      case 'cd': {
        const target = rest.join(' ').trim();
        if (!target) {
          const scope = this.persisted.folders;
          await this.reply(
            m,
            scope.length > 0
              ? `可用文件夹：\n${scope.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n/ws <序号或路径> 切换`
              : `当前文件夹：${rt.folder}\n未设置范围限制，/ws <绝对路径> 直接切`,
          );
          break;
        }
        let folder = target;
        const idx = Number(target) - 1;
        if (this.persisted.folders[idx]) folder = this.persisted.folders[idx];
        if (this.persisted.folders.length > 0 && !this.persisted.folders.includes(folder)) {
          await this.reply(m, `⛔ 不在允许范围内：${folder}`);
          break;
        }
        rt.folder = folder;
        rt.engine = undefined; // 换文件夹 = 新会话（与本地行为一致）
        rt.sessionId = undefined;
        await this.saveSubject(key, rt);
        await this.reply(m, `📁 已切换到 ${folder}（新会话）`);
        break;
      }
      default:
        await this.reply(m, `未知命令 /${rawCmd}，/help 查看可用命令`);
    }
  }

  /** 主体路由表落盘（重启续接）。 */
  private async saveSubject(key: string, rt: SubjectRuntime): Promise<void> {
    const subjects = { ...this.persisted.subjects };
    if (rt.sessionId) subjects[key] = { folder: rt.folder, sessionId: rt.sessionId };
    else delete subjects[key];
    await this.setPersisted({ subjects });
  }

  private async ensureEngine(key: string, rt: SubjectRuntime): Promise<PiEngine> {
    if (rt.engine) return rt.engine;
    await migrateLegacyProviderKeys();
    const models = await availableModels();
    if (models.length === 0) throw new Error('未配置模型，请先在 Wisp 设置里添加');
    const saved = localStorage.getItem('wisp:pi-last-model') ?? '';
    const model = models.some((x) => x.ref === saved) ? saved : models[0].ref;

    // 重启续接：路由表里有 sessionId 则 resume 历史
    let resume: { id: string; messages: unknown[] } | undefined;
    if (rt.sessionId) {
      try {
        const history = await transport<unknown[]>('pi_session_read', { id: rt.sessionId });
        resume = { id: rt.sessionId, messages: history };
      } catch {
        rt.sessionId = undefined;
      }
    }

    const engine = await PiEngine.start({
      anchor: rt.folder,
      model,
      title: '微信会话',
      origin: 'wechat',
      resume,
      callbacks: {
        onTextDelta: () => undefined,
        onThinkingDelta: () => undefined,
        onApprovalRequest: async (request) => {
          if (rt.lastTo) {
            const preview = JSON.stringify(request.input).slice(0, 160);
            await this.channel
              .sendText(
                rt.lastTo,
                `🔒 需要批准：${request.name}\n${preview}\n回复「允许」或「拒绝」（90 秒超时自动拒绝）`,
                rt.lastContextToken,
              )
              .catch(() => undefined);
          }
          return new Promise<ApprovalDecision>((resolve) => {
            const timer = setTimeout(() => {
              rt.approvalResolve = undefined;
              resolve('deny');
            }, APPROVAL_TIMEOUT_MS);
            rt.approvalResolve = (d) => {
              clearTimeout(timer);
              resolve(d);
            };
          });
        },
        onComplete: () => undefined,
        onError: () => undefined,
      },
    });
    rt.engine = engine;
    if (rt.sessionId !== engine.sessionId) {
      rt.sessionId = engine.sessionId;
      await this.saveSubject(key, rt);
    }
    return engine;
  }

  private async reply(m: IlinkInboundMessage, text: string): Promise<void> {
    const to = m.groupId ?? m.fromUserId;
    for (let i = 0; i < text.length; i += TEXT_CHUNK_LIMIT) {
      await this.channel
        .sendText(to, text.slice(i, i + TEXT_CHUNK_LIMIT), m.contextToken)
        .catch((e) => this.pushLog(`[weixin] 回复失败: ${e}`));
    }
  }
}

export const weixinBridge = new WeixinBridge();
