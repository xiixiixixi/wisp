/**
 * 对话输入区 —— 照 ZCode 的两段式：情景条（模式+位置）在输入盒上方，
 * 输入盒内底部一行工具条（历史/新建 | 模型 ▾ | 思考 ▾ | 发送）。
 * Enter 发送，Shift+Enter 换行。颜色全部走 xp 令牌，两主题自动翻转。
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  History,
  Plus,
  ShieldCheck,
  Square,
  SquareSplitHorizontal,
  Zap,
} from 'lucide-react';
import PiModelPicker from './PiModelPicker';
import '@/styles/container-collapse.css';
import type { AvailableModel } from '@/lib/pi-engine/providers';

export type ThinkingLevel = 'auto' | 'off' | 'low' | 'medium' | 'high';
export type PermissionMode = 'ask' | 'full';

/** 斜杠命令：输入「/」弹出，回车执行（LibreChat / pi CLI 同款交互）。 */
interface SlashCommand {
  id: string;
  /** i18n 键（内置命令用）。 */
  labelKey?: string;
  /** 字面标签（技能等动态命令用，优先于 labelKey）。 */
  label?: string;
  /** 选中后要填入输入盒的文本（填空型命令，如技能点名）；与 run 二选一。 */
  fill?: string;
  /** 选中后执行的动作（执行型命令）；执行完清空输入盒。 */
  run?: () => void;
}

/** 按当前模式给出真实可执行的快捷指令（pi agent 常用任务）。 */
const quickPrompts = (mode: 'folder' | 'quick') =>
  mode === 'folder'
    ? [
        { key: 'piChat.sugOrganize' },
        { key: 'piChat.sugDuplicates' },
        { key: 'piChat.sugRecent' },
        { key: 'piChat.sugWhatHere' },
      ]
    : [
        { key: 'piChat.sugTranslate' },
        { key: 'piChat.sugExplain' },
        { key: 'piChat.sugWrite' },
        { key: 'piChat.sugCompare' },
      ];

const saveThinkingPref = (level: ThinkingLevel): void => {
  localStorage.setItem(THINKING_KEY, level);
};

/** 权限模式下拉 —— ZCode「完全访问」的对应物。ask = 写操作逐次审批（默认）。 */
const PermissionPicker = ({
  value,
  onChange,
}: {
  value: PermissionMode;
  onChange: (m: PermissionMode) => void;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const modes: { value: PermissionMode; label: string; desc: string }[] = [
    { value: 'ask', label: t('piChat.permAsk'), desc: t('piChat.permAskDesc') },
    { value: 'full', label: t('piChat.permFull'), desc: t('piChat.permFullDesc') },
  ];
  const current = modes.find((m) => m.value === value) ?? modes[0];

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors hover:bg-xp-surface-light ${
          value === 'full' ? 'text-xp-orange' : 'text-xp-text-muted'
        }`}
        onClick={() => setOpen((v) => !v)}
        title={current.desc}
        data-testid="pi-permission-picker"
      >
        <ShieldCheck size={12} />
        {/* 容器查询：窄列（画布 300px 对话列）只留图标，宽了再显字 */}
        <span className="pi-composer-label">{current.label}</span>
        <ChevronDown size={10} className="opacity-60" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-50 mb-1 w-52 rounded-md border border-xp-border bg-xp-popover p-1 shadow-lg"
        >
          {modes.map((m) => (
            <button
              key={m.value}
              type="button"
              role="menuitem"
              className={`flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-[11px] ${
                m.value === value
                  ? 'bg-xp-blue font-medium text-xp-on-accent'
                  : 'text-xp-text hover:bg-xp-blue hover:text-xp-on-accent'
              }`}
              onClick={() => {
                onChange(m.value);
                setOpen(false);
              }}
            >
              <span className="flex w-full items-center gap-1.5">
                {m.value === 'full' && <ShieldCheck size={11} className="text-xp-orange" />}
                <span className="min-w-0 flex-1">{m.label}</span>
                {m.value === value && <Check size={11} className="shrink-0 text-xp-on-accent" />}
              </span>
              <span className="text-[10px] leading-3 text-xp-text-muted">{m.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** 思考档位下拉 —— ZCode「最高」控件的对应物；auto = 跟随模型/全局配置。 */
const ThinkingPicker = ({
  value,
  onChange,
}: {
  value: ThinkingLevel;
  onChange: (t: ThinkingLevel) => void;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const levels: { value: ThinkingLevel; label: string }[] = [
    { value: 'auto', label: t('settings.aiCfg.thinkAuto') },
    { value: 'off', label: t('settings.aiCfg.thinkOff') },
    { value: 'low', label: t('settings.aiCfg.thinkLow') },
    { value: 'medium', label: t('settings.aiCfg.thinkMedium') },
    { value: 'high', label: t('settings.aiCfg.thinkHigh') },
  ];
  const current = levels.find((l) => l.value === value);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors hover:bg-xp-surface-light ${
          value === 'auto' ? 'text-xp-text-muted' : 'text-xp-text'
        }`}
        onClick={() => setOpen((v) => !v)}
        title={t('piChat.thinkLabel')}
        data-testid="pi-thinking-picker"
      >
        <Brain size={12} className={value !== 'auto' ? 'text-xp-accent' : ''} />
        <span className="pi-composer-label">{current?.label}</span>
        <ChevronDown size={10} className="opacity-60" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-50 mb-1 w-32 whitespace-nowrap rounded-md border border-xp-border bg-xp-popover p-1 shadow-lg"
        >
          {levels.map((l) => (
            <button
              key={l.value}
              type="button"
              role="menuitem"
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[11px] ${
                l.value === value
                  ? 'bg-xp-blue font-medium text-xp-on-accent'
                  : 'text-xp-text hover:bg-xp-blue hover:text-xp-on-accent'
              }`}
              onClick={() => {
                onChange(l.value);
                saveThinkingPref(l.value);
                setOpen(false);
              }}
            >
              <span className="min-w-0 flex-1">{l.label}</span>
              {l.value === value && <Check size={11} className="ml-1.5 shrink-0 text-xp-on-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

interface PiChatComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  placeholder?: string;
  mode: 'folder' | 'quick';
  onModeChange: (m: 'folder' | 'quick') => void;
  anchorText: string;
  thinking: ThinkingLevel;
  onThinkingChange: (t: ThinkingLevel) => void;
  models: AvailableModel[];
  modelValue: string;
  onModelChange: (ref: string) => void;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onNewChat: () => void;
  permission: PermissionMode;
  onPermissionChange: (m: PermissionMode) => void;
  /** 画布模式开关（入口 A）：点亮后本会话左文档右对话。 */
  canvasOn?: boolean;
  onCanvasToggle?: (on: boolean) => void;
  /** 快捷功能菜单：把 pi agent 的常用任务一键填入输入盒。 */
  onQuickPrompt?: (prompt: string) => void;
  /** 变化时聚焦输入盒（+ 新建等动作给「确实做了什么」的反馈）。 */
  focusToken?: number;
  /** 已发现的 agent 技能（~/.agents/skills 等）→ 斜杠菜单可点名。 */
  skills?: { name: string; description: string }[];
}

const THINKING_KEY = 'wisp:pi-thinking';

/** 快捷功能下拉 —— pi agent 的常用任务入口（Zap）。 */
const QuickActions = ({
  mode,
  onPick,
}: {
  mode: 'folder' | 'quick';
  onPick: (prompt: string) => void;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors hover:bg-xp-surface-light ${
          open ? 'bg-xp-surface-light text-xp-text' : 'text-xp-text-muted'
        }`}
        onClick={() => setOpen((v) => !v)}
        title={t('piChat.quickActions')}
        data-testid="pi-quick-actions"
      >
        <Zap size={12} className="text-xp-accent" />
        <ChevronDown size={10} className="opacity-60" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-50 mb-1 w-52 rounded-md border border-xp-border bg-xp-popover p-1 shadow-lg"
        >
          {quickPrompts(mode).map(({ key }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              className="group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-xp-text hover:bg-xp-blue hover:text-xp-on-accent"
              onClick={() => {
                onPick(t(key));
                setOpen(false);
              }}
            >
              <Zap size={10} className="shrink-0 text-xp-text-muted group-hover:text-xp-on-accent" />
              <span className="min-w-0 flex-1">{t(key)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const loadThinkingPref = (): ThinkingLevel => {
  const saved = localStorage.getItem(THINKING_KEY);
  return saved === 'off' || saved === 'low' || saved === 'medium' || saved === 'high'
    ? saved
    : 'auto';
};

const PiChatComposer = ({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  placeholder,
  mode,
  onModeChange,
  anchorText,
  thinking,
  onThinkingChange,
  models,
  modelValue,
  onModelChange,
  historyOpen,
  onToggleHistory,
  onNewChat,
  permission,
  onPermissionChange,
  canvasOn = false,
  onCanvasToggle,
  onQuickPrompt,
  focusToken = 0,
  skills = [],
}: PiChatComposerProps) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashActive, setSlashActive] = useState(0);

  // + 新建等动作通过递增 token 请求聚焦
  useEffect(() => {
    if (focusToken > 0) ref.current?.focus();
  }, [focusToken]);

  /** 斜杠命令表：全部是真实动作（无占位）。 */
  const slashCommands: SlashCommand[] = [
    { id: 'canvas', labelKey: 'piChat.cmdCanvas', run: () => onCanvasToggle?.(!canvasOn) },
    { id: 'new', labelKey: 'piChat.cmdNew', run: onNewChat },
    { id: 'history', labelKey: 'piChat.cmdHistory', run: onToggleHistory },
    { id: 'folder', labelKey: 'piChat.cmdFolder', run: () => onModeChange('folder') },
    { id: 'quick', labelKey: 'piChat.cmdQuick', run: () => onModeChange('quick') },
    {
      id: 'settings',
      labelKey: 'piChat.cmdModel',
      run: () => window.dispatchEvent(new CustomEvent('wisp-open-settings')),
    },
    // 用户技能（~/.agents/skills）：点名调用，正文由引擎侧 skill 工具加载
    ...skills.map((sk) => ({
      id: sk.name,
      label: sk.description || sk.name,
      fill: `使用技能 ${sk.name}：`,
    })),
  ];

  // 「/xx」进行中且未按 Esc 关闭 → 过滤命令；id 和本地化名都参与匹配。
  const slashQuery =
    value.startsWith('/') && !value.includes(' ') && !slashDismissed ? value.slice(1) : null;
  const slashItems =
    slashQuery === null
      ? []
      : slashCommands.filter((c) => {
          const q = slashQuery.toLowerCase();
          const text = c.label ?? t(c.labelKey ?? '');
          return (
            c.id.toLowerCase().includes(q) ||
            text.toLowerCase().includes(q) ||
            text.includes(slashQuery)
          );
        });
  useEffect(() => {
    setSlashActive(0);
  }, [slashQuery]);
  useEffect(() => {
    if (!value.startsWith('/')) setSlashDismissed(false);
  }, [value]);

  const execSlash = (cmd: SlashCommand) => {
    if (cmd.fill) {
      onChange(cmd.fill); // 填空型（技能点名）：填入后由用户补充需求再发送
    } else {
      cmd.run?.();
      onChange('');
    }
    setSlashDismissed(false);
    ref.current?.focus();
  };

  const iconBtn =
    'flex h-6 w-6 items-center justify-center rounded-md text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text';

  return (
    <div className="pi-composer flex-shrink-0 px-3 pb-3 pt-1">
      {/* 情景条：模式 + 位置 */}
      <div className="mb-1 flex items-center gap-2 px-0.5">
        <div className="flex items-center gap-0.5 text-[11px]">
          <button
            type="button"
            className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors ${
              mode === 'folder'
                ? 'bg-xp-surface-light font-medium text-xp-text'
                : 'text-xp-text-muted hover:text-xp-text'
            }`}
            onClick={() => onModeChange('folder')}
            data-testid="pi-chat-mode-folder"
          >
            {t('piChat.modeFolder')}
          </button>
          <button
            type="button"
            className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors ${
              mode === 'quick'
                ? 'bg-xp-surface-light font-medium text-xp-text'
                : 'text-xp-text-muted hover:text-xp-text'
            }`}
            onClick={() => onModeChange('quick')}
            data-testid="pi-chat-mode-quick"
          >
            {t('piChat.modeQuick')}
          </button>
        </div>
        <div
          className="min-w-0 flex-1 truncate text-[11px] text-xp-text-muted"
          title={mode === 'folder' ? anchorText : undefined}
        >
          {mode === 'folder' ? anchorText : t('piChat.quickHint')}
        </div>
      </div>

      {/* 输入盒 */}
      <div className="relative rounded-[10px] border border-xp-border bg-xp-surface px-2.5 py-2 transition-colors focus-within:border-xp-accent">
        {/* 斜杠命令菜单：输入 / 唤出，↑↓ 选择，回车执行，Esc 关闭 */}
        {slashItems.length > 0 && (
          <div
            data-testid="pi-slash-menu"
            role="listbox"
            aria-label={t('piChat.slashMenu')}
            className="absolute bottom-full left-0 right-0 z-50 mb-1.5 overflow-hidden rounded-md border border-xp-border bg-xp-popover p-1 shadow-lg"
          >
            {slashItems.map((c, i) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={i === slashActive}
                data-testid="pi-slash-item"
                className={`group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] ${
                  i === slashActive
                    ? 'bg-xp-blue font-medium text-xp-on-accent'
                    : 'text-xp-text hover:bg-xp-blue hover:text-xp-on-accent'
                }`}
                onMouseEnter={() => setSlashActive(i)}
                onClick={() => execSlash(c)}
              >
                <span
                  className={`font-mono ${
                    i === slashActive
                      ? 'text-xp-on-accent'
                      : 'text-xp-accent group-hover:text-xp-on-accent'
                  }`}
                >
                  /{c.id}
                </span>
                <span className="min-w-0 flex-1 truncate">{c.label ?? t(c.labelKey ?? '')}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (slashItems.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSlashActive((i) => (i + 1) % slashItems.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSlashActive((i) => (i - 1 + slashItems.length) % slashItems.length);
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                execSlash(slashItems[Math.min(slashActive, slashItems.length - 1)]);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setSlashDismissed(true);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!busy) onSend();
            }
          }}
          placeholder={placeholder ?? t('aiChat.input.sendMessage')}
          aria-label={t('aiChat.input.sendMessage')}
          rows={2}
          className="w-full resize-none bg-transparent text-sm leading-5 text-xp-text outline-none placeholder:text-xp-text-muted"
        />
        <div className="flex items-center gap-1 pt-1.5">
          {/* 新建会话 — 最左端（ZCode/Cursor 同位） */}
          <button
            type="button"
            aria-label={t('piChat.newChat')}
            title={t('piChat.newChat')}
            onClick={onNewChat}
            data-testid="pi-chat-new"
            className={iconBtn}
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            aria-label={t('piChat.history')}
            title={t('piChat.history')}
            onClick={onToggleHistory}
            data-testid="pi-chat-history"
            className={`${iconBtn} ${historyOpen ? 'bg-xp-surface-light text-xp-text' : ''}`}
          >
            <History size={13} />
          </button>
          {/* 快捷功能（pi agent 常用任务） */}
          {onQuickPrompt && <QuickActions mode={mode} onPick={onQuickPrompt} />}
          {/* 画布模式开关（点亮=文档列+对话列同屏），图标=左右分屏 */}
          {onCanvasToggle && (
            <button
              type="button"
              aria-label={canvasOn ? t('piChat.canvasOff') : t('piChat.canvasOn')}
              title={canvasOn ? t('piChat.canvasOff') : t('piChat.canvasOn')}
              onClick={() => onCanvasToggle(!canvasOn)}
              data-testid="pi-canvas-toggle"
              className={`${iconBtn} ${canvasOn ? 'bg-xp-surface-light text-xp-accent' : ''}`}
              aria-pressed={canvasOn}
            >
              <SquareSplitHorizontal size={13} />
            </button>
          )}
          {/* 权限模式（ZCode「完全访问」对应物） */}
          <PermissionPicker value={permission} onChange={onPermissionChange} />

          <div className="min-w-0 flex-1" />

          {/* 模型 ▾（纯文字，ZCode 式） */}
          <PiModelPicker
            models={models}
            value={modelValue}
            onChange={onModelChange}
            compact
          />

          {/* 思考 ▾ */}
          <ThinkingPicker value={thinking} onChange={onThinkingChange} />

          {/* 发送 / 停止 */}
          {busy ? (
            <button
              type="button"
              aria-label={t('aiChat.input.stop')}
              onClick={onStop}
              className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md bg-xp-accent text-xp-on-accent hover:bg-xp-accent-hover"
            >
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              aria-label={t('aiChat.input.sendMessage')}
              disabled={!value.trim()}
              onClick={onSend}
              data-testid="pi-chat-send"
              className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md transition-colors ${
                value.trim()
                  ? 'bg-xp-accent text-xp-on-accent hover:bg-xp-accent-hover'
                  : 'bg-xp-surface-light text-xp-text-muted'
              }`}
            >
              <ArrowUp size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PiChatComposer;
