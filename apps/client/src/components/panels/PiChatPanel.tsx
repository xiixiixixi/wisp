/**
 * PiChatPanel — 对话面板。
 *
 * 布局照 ZCode 桌面版实测规格：无气泡平铺文档流（用户消息=加粗首行、
 * 助手=Markdown 正文，1px 分隔线分轮次），双段式输入盒（情景条+工具条
 * 内嵌模型/思考/发送）。颜色全部走 xp 令牌，浅色/深色两主题自动翻转。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowRight, Copy, FileText, Loader2, ShieldAlert, Trash2, X } from 'lucide-react';
import PiChatComposer, {
  loadThinkingPref,
  type PermissionMode,
  type ThinkingLevel,
} from './PiChatComposer';
import { useSessionEvents } from './agent-manager/use-session-events';
import { PanelConfirmation } from './PanelFeedback';
import { transport, isTauri } from '@/lib/transport';
import {
  PiEngine,
  type ApprovalRequest,
  type ApprovalDecision,
  type SessionMetaDto,
} from '@/lib/pi-engine/engine';
import {
  availableModels as discoverModels,
  migrateLegacyProviderKeys,
  type AvailableModel,
} from '@/lib/pi-engine/providers';
import { discoverSkills, type WispSkill } from '@/lib/pi-engine/skills';

interface PiChatPanelProps {
  currentPath: string;
  /** 画布模式：文档列 + 对话列同屏（由 RightSidebar 传入）。 */
  canvasMode?: boolean;
  onCanvasChange?: (on: boolean) => void;
}

type Mode = 'folder' | 'quick';

interface UiMessage {
  role: 'user' | 'assistant';
  text: string;
}

/** 文档区选中的一段文字（「引用」浮条发来，可叠加多条）。 */
interface PendingSelection {
  text: string;
  filePath: string;
  fileName: string;
}

/** 引用条数上限——再多就该直接描述需求而不是堆引文。 */
const MAX_PENDING_SELECTIONS = 5;

/** 画布自动进入只认文档类产物：代码/配置写入不抢布局。 */
const CANVAS_DOC_EXTS = new Set(['md', 'markdown', 'txt', 'text']);

const PiChatPanel = ({ currentPath, canvasMode = false, onCanvasChange }: PiChatPanelProps) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('folder');
  const [model, setModel] = useState<string>('');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [thinkingText, setThinkingText] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionMetaDto[]>([]);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [deletingSession, setDeletingSession] = useState<SessionMetaDto | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [available, setAvailable] = useState<AvailableModel[]>([]);
  const [skills, setSkills] = useState<WispSkill[]>([]);
  const [thinking, setThinking] = useState<ThinkingLevel>(loadThinkingPref);
  const [pendingSelections, setPendingSelections] = useState<PendingSelection[]>([]);
  const [focusToken, setFocusToken] = useState(0);
  const [permission, setPermission] = useState<PermissionMode>(() =>
    localStorage.getItem('wisp:pi-permission') === 'full' ? 'full' : 'ask',
  );

  const engineRef = useRef<PiEngine | null>(null);
  const approvalResolverRef = useRef<((d: ApprovalDecision) => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const anchor = mode === 'folder' ? currentPath : null;
  const toolEvents = useSessionEvents(sessionId);

  useEffect(() => {
    let cancelled = false;
    const runDiscovery = async () => {
      await migrateLegacyProviderKeys();
      const list = await discoverModels();
      if (cancelled) return;
      setAvailable(list);
      void discoverSkills()
        .then(setSkills)
        .catch(() => undefined);
      const savedDefault = localStorage.getItem('wisp:pi-last-model') || '';
      const preferred = list.some((m) => m.ref === savedDefault)
        ? savedDefault
        : (list[0]?.ref ?? '');
      setModel((current) => (current && current !== 'ollama:llama3.2' ? current : preferred));
    };
    void runDiscovery();
    const onSettingsChanged = () => {
      void runDiscovery();
    };
    window.addEventListener('wisp-settings-changed', onSettingsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('wisp-settings-changed', onSettingsChanged);
    };
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const all = await transport<SessionMetaDto[]>('pi_session_list');
      setSessions(
        mode === 'folder'
          ? all.filter((s) => s.anchor === currentPath)
          : all.filter((s) => s.anchor === null),
      );
    } catch {
      setSessions([]);
    }
  }, [mode, currentPath]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    engineRef.current = null;
    setSessionId(null);
    setMessages([]);
    setStreamingText('');
    setThinkingText('');
    setError(null);
  }, [mode]);

  // 快捷动作、代码预览按钮与文档「引用」浮条都带着问题召唤本面板；
  // 选区（selection）随行时挂进引用列表并聚焦输入盒（ZCode：引用进条、指令在主框打）。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt?: string; selection?: PendingSelection }>)
        .detail;
      if (detail?.selection) {
        const s = detail.selection;
        setPendingSelections((prev) => {
          // 同一段重复引用不叠；超上限丢最旧（保最新的意图）。
          const deduped = prev.filter((x) => !(x.text === s.text && x.filePath === s.filePath));
          return [...deduped, s].slice(-MAX_PENDING_SELECTIONS);
        });
        setFocusToken((n) => n + 1);
      }
      if (detail?.prompt) setInput(detail.prompt);
    };
    window.addEventListener('wisp-ai-chat-request', handler);
    return () => window.removeEventListener('wisp-ai-chat-request', handler);
  }, []);

  useEffect(() => {
    // 对话跟随浏览位置：真文件夹 → 文件夹模式；主页等虚拟路径 → 速聊。
    // 手动切换只在当前视图内有效，切换位置后回到语境默认（不再持久化，
    // 否则一旦点过速聊，之后无论浏览哪个文件夹都停在速聊）。
    setMode(currentPath.startsWith('/') ? 'folder' : 'quick');
    engineRef.current = null;
    setSessionId(null);
    setMessages([]);
    setStreamingText('');
  }, [currentPath]);

  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight });
  }, [messages, streamingText, toolEvents.length, approval]);

  const ensureEngine = useCallback(async (): Promise<PiEngine> => {
    if (engineRef.current) return engineRef.current;
    if (!model) throw new Error(t('piChat.noModel'));

    const callbacks = {
      onTextDelta: (text: string) => setStreamingText((prev) => prev + text),
      onThinkingDelta: (text: string) => setThinkingText((prev) => prev + text),
      onApprovalRequest: (request: ApprovalRequest) =>
        new Promise<ApprovalDecision>((resolve) => {
          approvalResolverRef.current = resolve;
          setApproval(request);
        }),
      onComplete: () => undefined,
      onError: (message: string) => setError(message),
    };

    let resume: { id: string; messages: unknown[] } | undefined;
    if (sessionId) {
      const history = await transport<unknown[]>('pi_session_read', { id: sessionId });
      resume = { id: sessionId, messages: history };
    }

    const engine = await PiEngine.start({
      anchor,
      model,
      title: mode === 'folder' ? undefined : t('piChat.quickTitle'),
      callbacks,
      resume,
      thinkingLevel: thinking,
      autoApprove: permission === 'full' ? 'all' : undefined,
    });
    engineRef.current = engine;
    setSessionId(engine.sessionId);
    return engine;
  }, [anchor, model, sessionId, mode, thinking, permission, t]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setError(null);
    setInput('');
    // 有挂起引用时按「只改引用部分」模板拼装；拼装后的全文即用户消息本体，
    // 平铺在会话流里，改了什么、原句是什么一眼可查。多条引用逐条列出。
    const finalPrompt =
      pendingSelections.length > 0
        ? t('piChat.canvasSelectionTemplate', {
            instruction: text,
            quotes: pendingSelections
              .map((s) => `${s.filePath}:\n<<<\n${s.text}\n>>>`)
              .join('\n\n'),
          })
        : text;
    setPendingSelections([]);
    setMessages((prev) => [...prev, { role: 'user', text: finalPrompt }]);
    setLoading(true);
    setStreamingText('');
    setThinkingText('');
    try {
      const isFirstMessage = messages.length === 0 && !sessionId;
      const engine = await ensureEngine();
      const finalText = await engine.prompt(finalPrompt);
      setMessages((prev) => [...prev, { role: 'assistant', text: finalText }]);
      // 会话自动取首条消息为标题（VS Code/Zed/Cursor 共识）
      if (isFirstMessage && isTauri()) {
        const title = text.replace(/\s+/g, ' ').trim().slice(0, 24) || text.slice(0, 24);
        void transport('pi_session_rename', { id: engine.sessionId, title }).catch(() => undefined);
      }
      refreshSessions();
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: `${t('piChat.failed')}: ${String(e instanceof Error ? e.message : e)}`,
        },
      ]);
    } finally {
      setStreamingText('');
      setThinkingText('');
      setLoading(false);
    }
  }, [input, loading, ensureEngine, refreshSessions, pendingSelections, t]);

  useEffect(() => {
    localStorage.setItem('wisp:pi-permission', permission);
    engineRef.current?.setAutoApprove(permission === 'full' ? 'all' : new Set());
  }, [permission]);

  const cancel = useCallback(() => {
    engineRef.current?.abort();
    setLoading(false);
    setStreamingText('');
    setThinkingText('');
  }, []);

  const resolveApproval = useCallback((decision: ApprovalDecision) => {
    approvalResolverRef.current?.(decision);
    approvalResolverRef.current = null;
    setApproval(null);
  }, []);

  const newConversation = useCallback(() => {
    engineRef.current?.abort();
    engineRef.current = null;
    setSessionId(null);
    setMessages([]);
    setStreamingText('');
    setThinkingText('');
    setError(null);
    // 新建要有可感知的反馈：清掉草稿/引用/历史抽屉，并把焦点交还输入盒。
    setInput('');
    setPendingSelections([]);
    setShowHistory(false);
    setFocusToken((n) => n + 1);
  }, []);

  const loadSession = useCallback(async (id: string) => {
    engineRef.current = null;
    setStreamingText('');
    setError(null);
    setSessionId(id);
    setShowHistory(false);
    try {
      const history = await transport<Record<string, unknown>[]>('pi_session_read', { id });
      setMessages(
        history
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            text:
              typeof m.content === 'string'
                ? m.content
                : Array.isArray(m.content)
                  ? (m.content as Array<{ type: string; text?: string }>)
                      .filter((b) => b.type === 'text')
                      .map((b) => b.text ?? '')
                      .join('')
                  : '',
          })),
      );
    } catch {
      setMessages([]);
    }
  }, []);

  const deleteSession = useCallback(
    async (id: string) => {
      setDeleteBusy(true);
      try {
        await transport('pi_session_delete', { id });
        setDeletingSession(null);
        refreshSessions();
        if (sessionId === id) newConversation();
      } catch (error) {
        setError(t('panelActions.deleteChatFailed', { error: String(error) }));
        setDeletingSession(null);
      } finally {
        setDeleteBusy(false);
      }
    },
    [refreshSessions, sessionId, newConversation, t],
  );

  const visibleSessions = useMemo(() => sessions.slice(0, 20), [sessions]);

  // ── 画布模式 ────────────────────────────────────────────────────────────────

  /** 开关（入口 A）：开 = 走 wisp-canvas-request 让 MainLayout 统一处理（含加宽、选文件）；关 = 直接落状态。 */
  const toggleCanvas = useCallback(
    (next: boolean) => {
      if (next) {
        window.dispatchEvent(new CustomEvent('wisp-canvas-request', { detail: {} }));
      } else {
        onCanvasChange?.(false);
      }
    },
    [onCanvasChange],
  );

  /** 本会话 AI 写过的文件（去重、新写在前）→ 聊天流文件卡片。 */
  const writtenFiles = useMemo(() => {
    const out: { path: string; name: string }[] = [];
    for (const e of toolEvents) {
      if (e.type === 'tool_call' && e.toolName === 'write_file') {
        const p = typeof e.input?.path === 'string' ? e.input.path : null;
        if (p && !out.some((x) => x.path === p)) {
          out.push({ path: p, name: p.split('/').pop() ?? p });
        }
      }
    }
    return out.reverse();
  }, [toolEvents]);

  // 入口 B：write_file 落盘成功且产物是文档类 → 自动进入画布并选中该文件。
  // 会话内写同一路径多次只自动开一次（再次可点文件卡片）。
  const writePathRef = useRef<string | null>(null);
  const autoOpenedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const e of toolEvents) {
      if (e.type === 'tool_call' && e.toolName === 'write_file') {
        const p = typeof e.input?.path === 'string' ? e.input.path : null;
        if (p) writePathRef.current = p;
      }
    }
  }, [toolEvents]);
  useEffect(() => {
    if (!onCanvasChange) return;
    const completed = toolEvents.some(
      (e) =>
        e.type === 'tool_result' && e.toolName === 'write_file' && e.toolStatus === 'completed',
    );
    if (!completed) return;
    const path = writePathRef.current;
    if (!path || autoOpenedRef.current.has(path)) return;
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    if (!CANVAS_DOC_EXTS.has(ext)) return;
    autoOpenedRef.current.add(path);
    window.dispatchEvent(
      new CustomEvent('wisp-canvas-request', {
        detail: { path, name: path.split('/').pop() ?? path },
      }),
    );
  }, [toolEvents, onCanvasChange]);

  // 换会话/换位置时清掉自动开过的记录，避免旧路径占坑。
  useEffect(() => {
    autoOpenedRef.current.clear();
    writePathRef.current = null;
  }, [sessionId, mode, currentPath]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="pi-chat-panel">
      <PanelConfirmation
        open={deletingSession !== null}
        title={t('panelActions.deleteChatTitle')}
        description={t('panelActions.deleteChatDescription', { name: deletingSession?.title })}
        confirmLabel={t('piChat.deleteSession')}
        busy={deleteBusy}
        onCancel={() => setDeletingSession(null)}
        onConfirm={() => {
          if (deletingSession) void deleteSession(deletingSession.id);
        }}
      />
      {/* 历史抽屉（从输入盒工具条展开向上） */}
      {showHistory && (
        <div className="mx-3 mb-1 max-h-44 flex-shrink-0 overflow-y-auto rounded-md border border-xp-border bg-xp-popover px-1 py-1 shadow-lg">
          {visibleSessions.length === 0 && (
            <div className="py-2 text-center text-[11px] text-xp-text-muted">
              {t('piChat.noSessions')}
            </div>
          )}
          {visibleSessions.map((s) => (
            <div
              key={s.id}
              className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-xp-surface-light ${
                sessionId === s.id ? 'bg-xp-surface-light' : ''
              }`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate py-1 text-left text-xp-text"
                disabled={loading}
                onClick={() => loadSession(s.id)}
              >
                {s.title}
              </button>
              <span className="text-[10px] text-xp-text-muted">{s.message_count}</span>
              <button
                type="button"
                className="rounded p-1.5 text-xp-text-muted opacity-0 hover:text-xp-red focus-visible:opacity-100 group-hover:opacity-100"
                disabled={loading}
                aria-label={t('piChat.deleteSession')}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeletingSession(s);
                }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 消息区：无气泡平铺文档流（ZCode 式） */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {/* 空状态：未配置时只显示一步引导；可用时显示欢迎语与建议词条 */}
        {messages.length === 0 && !loading && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-1">
            {available.length === 0 ? (
              <div className="w-full max-w-[260px] text-left">
                <h3 className="text-[15px] font-medium text-xp-text">
                  {t('piChat.needModelTitle')}
                </h3>
                <p className="mt-2 text-[13px] leading-5 text-xp-text-secondary">
                  {t('piChat.needModelDesc')}
                </p>
                <button
                  type="button"
                  className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded text-[13px] font-medium text-xp-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-xp-accent"
                  onClick={(event) =>
                    window.dispatchEvent(
                      new CustomEvent('wisp-open-settings', {
                        detail: { returnFocus: event.currentTarget },
                      }),
                    )
                  }
                  data-testid="pi-chat-open-settings"
                >
                  {t('piChat.goConfigure')}
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <>
                <div className="text-center">
                  <div className="text-[15px] font-semibold text-xp-text">
                    {mode === 'folder' ? t('piChat.welcomeTitle') : t('piChat.welcomeQuickTitle')}
                  </div>
                  <div className="mt-1 text-[11px] text-xp-text-muted">
                    {mode === 'folder'
                      ? `${t('piChat.welcomeIn')} ${currentPath.split('/').pop() || currentPath}`
                      : t('piChat.welcomeQuick')}
                  </div>
                </div>
                <div className="flex max-w-[240px] flex-wrap justify-center gap-1.5">
                  {(mode === 'folder'
                    ? [
                        t('piChat.sugOrganize'),
                        t('piChat.sugDuplicates'),
                        t('piChat.sugRecent'),
                        t('piChat.sugWhatHere'),
                      ]
                    : [
                        t('piChat.sugTranslate'),
                        t('piChat.sugExplain'),
                        t('piChat.sugWrite'),
                        t('piChat.sugCompare'),
                      ]
                  ).map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      className="rounded-md border border-xp-border px-2.5 py-1 text-[11px] text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
                      onClick={() => setInput(sug)}
                      data-testid="pi-suggestion"
                    >
                      {sug}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className="group/msg relative py-1.5">
            {/* 轮次分隔：每条用户消息前画一条发丝线（首轮除外） */}
            {m.role === 'user' && i > 0 && <div className="mb-2 mt-1 border-t border-xp-border" />}
            {m.role === 'user' ? (
              <div className="whitespace-pre-wrap break-words text-sm font-medium text-xp-text">
                {m.text}
              </div>
            ) : (
              <>
                <div className="pi-chat-md text-sm text-xp-text">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                </div>
                {m.text && (
                  <button
                    type="button"
                    aria-label={t('piChat.copyMessage')}
                    className="absolute right-0 top-1.5 rounded p-1 text-xp-text-muted opacity-0 transition-opacity hover:bg-xp-surface-light hover:text-xp-text group-hover/msg:opacity-100"
                    onClick={() => {
                      void navigator.clipboard?.writeText(m.text);
                    }}
                    data-testid={`pi-copy-msg-${i}`}
                  >
                    <Copy size={12} />
                  </button>
                )}
              </>
            )}
          </div>
        ))}

        {thinkingText && (
          <details className="my-1.5 overflow-hidden rounded-md border border-xp-border">
            <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-1.5 text-xs text-xp-text-muted hover:bg-xp-surface-light">
              {t('piChat.thinking')}
            </summary>
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-xp-border bg-xp-surface px-3 py-2 text-xs text-xp-text-muted">
              {thinkingText.slice(-2000)}
            </div>
          </details>
        )}

        {streamingText && (
          <div className="whitespace-pre-wrap break-words py-1.5 text-sm text-xp-text">
            {streamingText}
            <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-xp-text-muted align-middle" />
          </div>
        )}

        {loading && !streamingText && (
          <div className="flex items-center gap-2 px-1 py-2 text-[11px] text-xp-text-muted">
            <Loader2 size={12} className="animate-spin" /> {t('piChat.thinking')}
          </div>
        )}

        {/* AI 写入的文件 → 文件卡片（画布入口：点击打开文档列） */}
        {writtenFiles.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {writtenFiles.map((f) => (
              <div
                key={f.path}
                className="flex items-center gap-2 rounded-md border border-xp-border bg-xp-surface px-2.5 py-2"
                data-testid="pi-file-card"
              >
                <FileText size={14} className="shrink-0 text-xp-text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-xp-text" title={f.path}>
                    {f.name}
                  </div>
                  <div className="truncate text-[10px] text-xp-text-muted" title={f.path}>
                    {t('piChat.fileCardTitle')} · {f.path}
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-md border border-xp-border px-2 py-1 text-[10px] text-xp-text hover:bg-xp-surface-light"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent('wisp-canvas-request', {
                        detail: { path: f.path, name: f.name },
                      }),
                    )
                  }
                >
                  {t('piChat.fileCardOpen')}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 工具活动（来自后端事件流） */}
        {toolEvents.length > 0 && (
          <details className="mt-2 overflow-hidden rounded-md border border-xp-border">
            <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-1.5 text-xs text-xp-text-muted hover:bg-xp-surface-light">
              {t('piChat.activity')}（{toolEvents.filter((e) => e.type !== 'text_delta').length}）
            </summary>
            <div className="max-h-52 space-y-1 overflow-y-auto border-t border-xp-border bg-xp-surface px-3 py-2 text-xs text-xp-text-muted">
              {toolEvents
                .filter((e) => e.type !== 'text_delta')
                .slice(-12)
                .map((e) => (
                  <div key={e.id} className="flex items-center gap-1.5">
                    {e.type === 'tool_call' && (
                      <>
                        <Loader2 size={10} className="animate-spin" />
                        <span className="truncate">
                          {e.toolName}（{JSON.stringify(e.input ?? {}).slice(0, 60)}）
                        </span>
                      </>
                    )}
                    {e.type === 'tool_result' && (
                      <>
                        <span
                          className={e.toolStatus === 'error' ? 'text-xp-red' : 'text-xp-green'}
                        >
                          {e.toolStatus === 'error' ? '✗' : '✓'}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {e.toolName}: {(e.result ?? '').slice(0, 100)}
                        </span>
                      </>
                    )}
                    {e.type === 'error' && <span className="text-xp-red">{e.message}</span>}
                  </div>
                ))}
            </div>
          </details>
        )}

        {error && (
          <div className="mt-2 rounded-md border border-xp-border bg-xp-surface px-3 py-2 text-[11px] text-xp-red">
            {error}
          </div>
        )}
      </div>

      {/* 审批条 */}
      {approval && (
        <div
          className="flex flex-shrink-0 items-center gap-2 border-t border-xp-border bg-xp-surface px-3 py-2.5"
          data-testid="pi-chat-approval"
        >
          <ShieldAlert size={15} className="shrink-0 text-xp-yellow" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-xp-text">
              {t('piChat.approvalTitle', { tool: approval.name })}
            </div>
            <div className="truncate font-mono text-[10px] text-xp-text-secondary">
              {JSON.stringify(approval.input).slice(0, 140)}
            </div>
          </div>
          <button
            type="button"
            className="rounded-md px-2.5 py-1 text-[11px] text-xp-text hover:bg-xp-surface-light"
            onClick={() => resolveApproval('deny')}
          >
            {t('piChat.deny')}
          </button>
          <button
            type="button"
            className="rounded-md border border-xp-border px-2.5 py-1 text-[11px] text-xp-text hover:bg-xp-surface-light"
            onClick={() => resolveApproval('allow_always')}
          >
            {t('piChat.allowAlways')}
          </button>
          <button
            type="button"
            className="rounded-md bg-xp-accent px-2.5 py-1 text-[11px] text-xp-on-accent hover:bg-xp-accent-hover"
            onClick={() => resolveApproval('allow_once')}
          >
            {t('piChat.allowOnce')}
          </button>
        </div>
      )}

      {/* 引用条：文档「引用」浮条带来的挂起选区（可叠加），发送时逐条拼进提示词 */}
      {pendingSelections.length > 0 && (
        <div className="mx-3 mb-1 flex flex-shrink-0 flex-col gap-1">
          {pendingSelections.map((sel, i) => (
            <div
              key={`${sel.filePath}:${i}`}
              className="flex items-center gap-2 rounded-md border border-xp-border bg-xp-surface px-2.5 py-1.5"
              data-testid="pi-selection-chip"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-xp-accent" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[11px] text-xp-text-secondary">
                {t('piChat.selectionChip', {
                  n: sel.text.length,
                  file: sel.fileName,
                })}
              </span>
              <button
                type="button"
                aria-label={t('piChat.selectionClear')}
                title={t('piChat.selectionClear')}
                className="shrink-0 rounded p-0.5 text-xp-text-muted hover:bg-xp-surface-light hover:text-xp-text"
                onClick={() => setPendingSelections((prev) => prev.filter((_, idx) => idx !== i))}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      <PiChatComposer
        value={input}
        onChange={setInput}
        onSend={send}
        onStop={cancel}
        busy={loading}
        placeholder={t('aiChat.input.sendMessage')}
        mode={mode}
        onModeChange={setMode}
        anchorText={currentPath}
        thinking={thinking}
        onThinkingChange={setThinking}
        models={available}
        modelValue={model}
        onModelChange={setModel}
        historyOpen={showHistory}
        onToggleHistory={() => setShowHistory((v) => !v)}
        onNewChat={newConversation}
        permission={permission}
        onPermissionChange={setPermission}
        canvasOn={canvasMode}
        onCanvasToggle={toggleCanvas}
        onQuickPrompt={setInput}
        focusToken={focusToken}
        skills={skills}
      />
    </div>
  );
};

export default PiChatPanel;
