/** 对话输入区：资料、正文、发送共用一个边界，配置以当前值呈现。 */
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { PanelConfirmation } from './PanelFeedback';
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FilePlus2,
  MessageCircle,
  Plus,
  ShieldCheck,
  Square,
  SquareSplitHorizontal,
  Zap,
} from 'lucide-react';
import PiModelPicker from './PiModelPicker';
import PiComposerMenu from './PiComposerMenu';
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
  group?: 'skill';
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

/** 权限是可读的当前状态，不要求用户猜图标。 */
const PermissionPicker = ({
  value,
  onChange,
}: {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirmFull, setConfirmFull] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const modes = [
    { value: 'ask' as const, label: t('piChat.permAsk'), desc: t('piChat.permAskDesc') },
    { value: 'full' as const, label: t('piChat.permFull'), desc: t('piChat.permFullDesc') },
  ];
  const current = modes.find((mode) => mode.value === value)!;
  return (
    <div ref={ref} className="pi-permission-control">
      <button
        type="button"
        className="pi-permission-trigger"
        data-permission={value}
        onClick={() => setOpen((previous) => !previous)}
        title={current.desc}
        aria-label={current.label}
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="pi-permission-picker"
      >
        <ShieldCheck size={13} aria-hidden="true" />
        <span>{current.label}</span>
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open && (
        <PiComposerMenu
          anchorRef={ref}
          label={t('piChat.permissions')}
          width={272}
          onClose={() => setOpen(false)}
        >
          {modes.map((mode) => (
            <button
              key={mode.value}
              type="button"
              role="menuitemradio"
              tabIndex={-1}
              aria-checked={mode.value === value}
              className="pi-menu-item"
              onClick={() => {
                if (mode.value === 'full' && value !== 'full') setConfirmFull(true);
                else onChange(mode.value);
                setOpen(false);
              }}
            >
              <span className="pi-menu-item-copy">
                <span className="pi-menu-item-label">{mode.label}</span>
                <span className="pi-menu-item-description">{mode.desc}</span>
              </span>
              {mode.value === value && (
                <Check size={14} className="pi-menu-check" aria-hidden="true" />
              )}
            </button>
          ))}
        </PiComposerMenu>
      )}
      <PanelConfirmation
        open={confirmFull}
        title={t('panelActions.fullAccessTitle')}
        description={t('panelActions.fullAccessDescription')}
        confirmLabel={t('piChat.permFull')}
        onCancel={() => setConfirmFull(false)}
        onConfirm={() => {
          onChange('full');
          setConfirmFull(false);
        }}
      />
    </div>
  );
};

/** 较少使用的入口共用加号菜单；换页避免窄侧栏出现横向多级菜单。 */
const AddContextMenu = ({
  onAdd,
  mode,
  anchorText,
  onModeChange,
  canvasOn,
  onCanvasToggle,
  onQuickPrompt,
}: {
  onAdd: (kind: 'files' | 'folder' | 'current') => void;
  mode: 'folder' | 'quick';
  anchorText: string;
  onModeChange: (mode: 'folder' | 'quick') => void;
  canvasOn: boolean;
  onCanvasToggle?: (on: boolean) => void;
  onQuickPrompt?: (prompt: string) => void;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<'main' | 'context' | 'quick'>('main');
  const ref = useRef<HTMLDivElement>(null);
  const pageLabel = page === 'context' ? t('piChat.chatContext') : t('piChat.quickActions');
  const canAddCurrent = anchorText.startsWith('/');
  return (
    <div ref={ref} className="pi-add-control">
      <button
        type="button"
        className="pi-composer-icon-button"
        data-testid="pi-chat-add"
        aria-label={t('piChat.addContext')}
        title={t('piChat.addContext')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setPage('main');
          setOpen((previous) => !previous);
        }}
      >
        <Plus size={19} aria-hidden="true" />
      </button>
      {open && (
        <PiComposerMenu
          anchorRef={ref}
          label={page === 'main' ? t('piChat.addContext') : pageLabel}
          focusKey={page}
          width={258}
          onClose={() => setOpen(false)}
          onBack={page === 'main' ? undefined : () => setPage('main')}
        >
          {page !== 'main' && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-menu-keep-open
              className="pi-menu-item pi-menu-back"
              aria-label={t('piChat.menuBack')}
              onClick={() => setPage('main')}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              <span>{pageLabel}</span>
            </button>
          )}
          {page === 'main' && (
            <>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="pi-menu-item"
                data-testid="pi-chat-add-files"
                onClick={() => {
                  onAdd('files');
                  setOpen(false);
                }}
              >
                <FilePlus2 size={16} className="pi-menu-icon" aria-hidden="true" />
                <span className="pi-menu-item-copy">{t('piChat.addFiles')}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="pi-menu-item"
                data-testid="pi-chat-add-folder"
                onClick={() => {
                  onAdd('folder');
                  setOpen(false);
                }}
              >
                <FolderOpen size={16} className="pi-menu-icon" aria-hidden="true" />
                <span className="pi-menu-item-copy">{t('piChat.addFolder')}</span>
              </button>
              {canAddCurrent && (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="pi-menu-item"
                  data-testid="pi-chat-add-current"
                  onClick={() => {
                    onAdd('current');
                    setOpen(false);
                  }}
                >
                  <FolderOpen size={16} className="pi-menu-icon" aria-hidden="true" />
                  <span className="pi-menu-item-copy">{t('piChat.addCurrentFolder')}</span>
                </button>
              )}
              <div className="pi-menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="pi-menu-item"
                data-menu-keep-open
                data-testid="pi-chat-mode"
                onClick={() => setPage('context')}
              >
                {mode === 'folder' ? (
                  <FolderOpen size={16} className="pi-menu-icon" />
                ) : (
                  <MessageCircle size={16} className="pi-menu-icon" />
                )}
                <span className="pi-menu-item-copy">{t('piChat.chatContext')}</span>
                <span className="pi-menu-value">
                  {t(mode === 'folder' ? 'piChat.modeFolder' : 'piChat.modeQuick')}
                </span>
                <ChevronRight size={13} className="pi-menu-icon" aria-hidden="true" />
              </button>
              {onCanvasToggle && (
                <button
                  type="button"
                  role="menuitemcheckbox"
                  tabIndex={-1}
                  className="pi-menu-item"
                  data-testid="pi-canvas-toggle"
                  aria-checked={canvasOn}
                  onClick={() => {
                    onCanvasToggle(!canvasOn);
                    setOpen(false);
                  }}
                >
                  <SquareSplitHorizontal size={16} className="pi-menu-icon" aria-hidden="true" />
                  <span className="pi-menu-item-copy">{t('piChat.canvasLabel')}</span>
                  {canvasOn && <Check size={14} className="pi-menu-check" aria-hidden="true" />}
                </button>
              )}
              {onQuickPrompt && (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  data-menu-keep-open
                  className="pi-menu-item"
                  data-testid="pi-quick-actions"
                  onClick={() => setPage('quick')}
                >
                  <Zap size={16} className="pi-menu-icon" aria-hidden="true" />
                  <span className="pi-menu-item-copy">{t('piChat.quickActions')}</span>
                  <ChevronRight size={13} className="pi-menu-icon" aria-hidden="true" />
                </button>
              )}
            </>
          )}
          {page === 'context' &&
            (['folder', 'quick'] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="menuitemradio"
                tabIndex={-1}
                aria-checked={mode === item}
                data-testid={`pi-chat-mode-${item}`}
                className="pi-menu-item"
                title={item === 'folder' ? anchorText : t('piChat.quickHint')}
                onClick={() => {
                  onModeChange(item);
                  setOpen(false);
                }}
              >
                <span className="pi-menu-item-copy">
                  {t(item === 'folder' ? 'piChat.modeFolder' : 'piChat.modeQuick')}
                </span>
                {mode === item && <Check size={14} className="pi-menu-check" aria-hidden="true" />}
              </button>
            ))}
          {page === 'quick' &&
            quickPrompts(mode).map(({ key }) => (
              <button
                key={key}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="pi-menu-item"
                onClick={() => {
                  onQuickPrompt?.(t(key));
                  setOpen(false);
                }}
              >
                <span className="pi-menu-item-copy">{t(key)}</span>
              </button>
            ))}
        </PiComposerMenu>
      )}
    </div>
  );
};

interface PiChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  placeholder?: string;
  mode: 'folder' | 'quick';
  onModeChange: (mode: 'folder' | 'quick') => void;
  anchorText: string;
  thinking: ThinkingLevel;
  onThinkingChange: (level: ThinkingLevel) => void;
  models: AvailableModel[];
  modelValue: string;
  onModelChange: (ref: string) => void;
  onToggleHistory: () => void;
  onNewChat: () => void;
  onAddContext: (kind: 'files' | 'folder' | 'current') => void;
  permission: PermissionMode;
  onPermissionChange: (mode: PermissionMode) => void;
  canvasOn?: boolean;
  onCanvasToggle?: (on: boolean) => void;
  onQuickPrompt?: (prompt: string) => void;
  focusToken?: number;
  skills?: { name: string; description: string }[];
  context?: ReactNode;
}

const THINKING_KEY = 'wisp:pi-thinking';
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
  onToggleHistory,
  onNewChat,
  onAddContext,
  permission,
  onPermissionChange,
  canvasOn = false,
  onCanvasToggle,
  onQuickPrompt,
  focusToken = 0,
  skills = [],
  context,
}: PiChatComposerProps) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const slashMenuId = useId();
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashActive, setSlashActive] = useState(0);

  useEffect(() => {
    if (focusToken > 0) ref.current?.focus();
  }, [focusToken]);
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    const resize = () => {
      input.style.height = '0px';
      input.style.height = `${Math.min(168, Math.max(56, input.scrollHeight))}px`;
    };
    resize();
    let previousWidth = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (input.clientWidth !== previousWidth) {
        previousWidth = input.clientWidth;
        resize();
      }
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [value]);

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
      group: 'skill' as const,
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
    const items = document.querySelectorAll<HTMLElement>('[data-testid="pi-slash-item"]');
    items[slashActive]?.scrollIntoView?.({ block: 'nearest' });
  }, [slashActive]);
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

  return (
    <div className="pi-composer">
      <div ref={composerRef} className="pi-composer-box">
        {context}
        {/* 斜杠命令菜单：输入 / 唤出，↑↓ 选择，回车执行，Esc 关闭 */}
        {slashItems.length > 0 && (
          <PiComposerMenu
            anchorRef={composerRef}
            testId="pi-slash-menu"
            id={slashMenuId}
            role="listbox"
            label={t('piChat.slashMenu')}
            focusOnOpen={false}
            onClose={() => setSlashDismissed(true)}
          >
            {slashItems.map((c, i) => (
              <Fragment key={c.id}>
                {(i === 0 || c.group !== slashItems[i - 1].group) && (
                  <div className="pi-menu-title">
                    {t(c.group === 'skill' ? 'piChat.skillsGroup' : 'piChat.conversationActions')}
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  id={`${slashMenuId}-${i}`}
                  tabIndex={-1}
                  aria-selected={i === slashActive}
                  data-testid="pi-slash-item"
                  className="pi-menu-item pi-menu-command"
                  onMouseEnter={() => setSlashActive(i)}
                  onClick={() => execSlash(c)}
                >
                  <span title={`/${c.id}`} className="pi-menu-command-name">
                    /{c.id}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-left leading-4">
                    {c.label ?? t(c.labelKey ?? '')}
                  </span>
                </button>
              </Fragment>
            ))}
          </PiComposerMenu>
        )}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
              if (e.key === 'Enter' && !e.shiftKey) {
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
          aria-controls={slashItems.length > 0 ? slashMenuId : undefined}
          aria-activedescendant={
            slashItems.length > 0
              ? `${slashMenuId}-${Math.min(slashActive, slashItems.length - 1)}`
              : undefined
          }
          rows={2}
          className="pi-composer-input w-full resize-none text-sm leading-5 text-xp-text placeholder:text-xp-text-muted"
        />
        <div className="pi-composer-toolbar">
          <AddContextMenu
            onAdd={onAddContext}
            mode={mode}
            anchorText={anchorText}
            onModeChange={onModeChange}
            canvasOn={canvasOn}
            onCanvasToggle={onCanvasToggle}
            onQuickPrompt={
              onQuickPrompt
                ? (prompt) => {
                    onQuickPrompt(prompt);
                    ref.current?.focus();
                  }
                : undefined
            }
          />
          <div className="pi-composer-model-control">
            <PiModelPicker
              models={models}
              value={modelValue}
              onChange={onModelChange}
              thinking={thinking}
              onThinkingChange={(level) => {
                onThinkingChange(level);
                saveThinkingPref(level);
              }}
            />
          </div>
          <button
            type="button"
            className="pi-composer-send"
            data-testid="pi-chat-send"
            aria-label={busy ? t('aiChat.input.stop') : t('aiChat.input.sendMessage')}
            disabled={!busy && !value.trim()}
            onClick={busy ? onStop : onSend}
          >
            {busy ? (
              <Square size={13} fill="currentColor" aria-hidden="true" />
            ) : (
              <ArrowUp size={18} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
      <div className="pi-composer-status">
        <PermissionPicker value={permission} onChange={onPermissionChange} />
        <span
          className="pi-composer-context"
          title={mode === 'folder' ? anchorText : t('piChat.quickHint')}
          data-testid="pi-chat-context-status"
        >
          {mode === 'folder'
            ? anchorText.split('/').filter(Boolean).pop() || anchorText
            : t('piChat.modeQuick')}
        </span>
      </div>
    </div>
  );
};
export default PiChatComposer;
