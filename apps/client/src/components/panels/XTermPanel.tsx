import i18n from '@/i18n';
import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Plus, X, MoreHorizontal, Lock, Bell, Check, ChevronUp, ChevronDown } from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';
import type { PtyOutputPayload } from '@/lib/tauri-api/pty';
import {
  CLI_AGENT_LAUNCHED_EVENT,
  consumePendingCliLaunches,
  type CliAgentLaunch,
} from './agent-manager/cli-launch-bus';
import { markExternalAgentExited } from './agent-manager/external-agent-registry';
import { AnchoredMenu } from '@/components/ui/AnchoredMenu';
import { getTerminalTheme, getTerminalSearchDecorations } from '@/lib/terminal-theme';
import {
  createTerminalKeyHandler,
  editTerminalClipboard,
  type TerminalSearchControls,
} from '@/lib/terminal-input';
import {
  buildTerminalFontStack,
  linkModifierMatches,
  readTerminalCopyOnSelect,
  readTerminalFontFamily,
  readTerminalFontSize,
  readTerminalLigatures,
  readTerminalLinkModifier,
  readTerminalReadonlyByDefault,
  readTerminalScrollback,
  writeTerminalFontSize,
} from '@/lib/terminal-settings';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import {
  notifyCommandFinish,
  notifyCommandOutput,
  notifyCommandStart,
  setCommandWatchTarget,
} from '@/lib/terminal-command-badge';
import {
  attachShellIntegration,
  getSessionCwd,
  recordFileManagerCwd,
  recordSpawnCwd,
} from '@/lib/terminal-shell-integration';
import { hideTerminalLinkTooltip, showTerminalLinkTooltip } from '@/lib/terminal-link-tooltip';
import { isMacPlatform } from '@/lib/shortcut-utils';
import { toast } from '@/hooks/use-toast';
import TermInstance, { type CreateTabHooks, type TermTab } from './TermInstance';
import TerminalContextMenu, { type TerminalContextMenuItem } from './TerminalContextMenu';

import '@xterm/xterm/css/xterm.css';
import '@/styles/terminal.css';

// ── Types ────────────────────────────────────────────────────────────────────

interface XTermPanelProps {
  cwd: string;
  /** Whether the terminal is currently shown (VS Code semantics: the first
   *  terminal is created lazily on first show, then kept alive forever). */
  visible?: boolean;
  /** File-manager navigation hook: right-click "open in file manager" sends
   *  the session's latest OSC 7 cwd here. */
  onNavigate?: (path: string) => void;
}

// ── Multi-tab panel ──────────────────────────────────────────────────────────

let tabCounter = 0;

const reportClipboardError = (action: 'copy' | 'paste') => {
  toast({
    title: i18n.t(action === 'copy' ? 'xterm.copyFailed' : 'xterm.pasteFailed', {
      defaultValue: action === 'copy' ? '无法复制终端内容' : '无法粘贴到终端',
    }),
    description: i18n.t('xterm.clipboardRetry', {
      defaultValue: '请确认剪贴板中有文字，再从终端操作菜单重试。',
    }),
    variant: 'destructive',
  });
};

/** Links open with the configured modifier held (#42: ⌘/⌥/Ctrl, default ⌘);
 *  plain clicks keep their normal cursor/selection meaning, like Ghostty.
 *  The setting is read per click so changing it needs no addon rebuild. */
const openTerminalLink = (event: MouseEvent, uri: string): void => {
  if (!linkModifierMatches(event, readTerminalLinkModifier())) return;
  window.open(uri, '_blank', 'noopener');
};

const createTab = (
  label?: string,
  attachSessionId?: string,
  hooks: CreateTabHooks = {},
): TermTab => {
  tabCounter++;
  const id = attachSessionId ?? `pty-${Date.now()}-${tabCounter}`;
  const theme = getTerminalTheme();
  const terminal = new Terminal({
    cursorBlink: false,
    cursorStyle: 'bar',
    cursorWidth: 2,
    cursorInactiveStyle: 'outline',
    fontSize: readTerminalFontSize(),
    // A custom family replaces the head of the stack; the CJK-capable
    // fallback tail always survives (#3/#42).
    fontFamily: buildTerminalFontStack(readTerminalFontFamily()),
    lineHeight: 1.4,
    // Read at tab creation: scrollback cannot be re-sized on a live buffer,
    // so a settings change applies from the next session on (#9/#42).
    scrollback: readTerminalScrollback(),
    scrollOnUserInput: true,
    macOptionClickForcesSelection: true,
    altClickMovesCursor: true,
    allowTransparency: true,
    minimumContrastRatio: 4.5,
    theme,
    allowProposedApi: true,
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  const searchAddon = new SearchAddon();
  terminal.loadAddon(searchAddon);
  terminal.loadAddon(
    new WebLinksAddon(openTerminalLink, {
      // Full-href hover preview: the link text can lie, the tooltip cannot.
      hover: (event, uri) => showTerminalLinkTooltip(uri, event.clientX, event.clientY),
      leave: () => hideTerminalLinkTooltip(),
    }),
  );

  // Shell integration: OSC 7 (cwd) + OSC 133 (prompt marks) from the rc
  // snippet the Rust side injects at PTY spawn. The C/D marks also drive the
  // command-completion watch (#22).
  const integration = attachShellIntegration(terminal, id, {
    onCommandStart: () => notifyCommandStart(id),
    onCommandFinish: () => notifyCommandFinish(id),
  });
  setCommandWatchTarget(id, () => hooks.onCommandNotify?.(id));

  terminal.attachCustomKeyEventHandler(
    createTerminalKeyHandler(
      terminal,
      reportClipboardError,
      (size) => {
        fitAddon.fit();
        void TauriAPI.ptyResize(id, terminal.cols, terminal.rows).catch(() => {});
        hooks.onFontSizeChange?.(size);
      },
      hooks.onSearch,
      (direction) => integration.jumpToPrompt(direction),
    ),
  );

  return {
    id,
    label: label ?? i18n.t('xterm.session', { defaultValue: '终端 {{count}}', count: tabCounter }),
    terminal,
    fitAddon,
    searchAddon,
    integration,
    attached: attachSessionId !== undefined,
  };
};

const omitKey = <T,>(record: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
};

/** "3/7" for a live match, the no-results label for a dry search. */
const findResultsLabel = (
  results: { index: number; count: number } | null,
  noResults: string,
): string => {
  if (!results) return '';
  if (results.count === 0) return noResults;
  return `${Math.max(results.index + 1, 1)}/${results.count}`;
};

/** Terminal preferences the panel hot-applies (font size/family, copy-on-
 *  select, ligatures). Scrollback and shell are read at creation/spawn time
 *  instead — a live buffer cannot be re-sized. */
interface TerminalPanelPreferences {
  fontSize: number;
  fontFamily: string;
  copyOnSelect: boolean;
  ligatures: boolean;
}

const readPanelPreferences = (): TerminalPanelPreferences => ({
  fontSize: readTerminalFontSize(),
  fontFamily: buildTerminalFontStack(readTerminalFontFamily()),
  copyOnSelect: readTerminalCopyOnSelect(),
  ligatures: readTerminalLigatures(),
});

const XTermPanel = ({ cwd, visible = true, onNavigate }: XTermPanelProps) => {
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [activeTabId, setActiveTabId] = useState('');
  const [theme, setTheme] = useState(getTerminalTheme);
  const keepTabFocusRef = useRef(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const initialMenuFocusRef = useRef<'first' | 'last' | null>(null);
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(
    null,
  );
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  // Per-tab metadata lives beside the stable TermTab objects (titles from
  // OSC 0/2, read-only flag, bell badge) so changing a label never recreates
  // a tab — and never respawns or kills its PTY.
  const [tabTitles, setTabTitles] = useState<Record<string, string>>({});
  const [readonlyTabs, setReadonlyTabs] = useState<Record<string, boolean>>({});
  const [bellTabs, setBellTabs] = useState<Record<string, boolean>>({});
  const [preferences, setPreferences] = useState(readPanelPreferences);
  const { fontSize, fontFamily, copyOnSelect, ligatures } = preferences;
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ index: number; count: number } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Latest-value refs keep the search/bell callbacks stable across renders.
  const activeTabIdRef = useRef('');
  activeTabIdRef.current = activeTabId;
  const tabsRef = useRef<TermTab[]>([]);
  tabsRef.current = tabs;
  const searchQueryRef = useRef('');
  searchQueryRef.current = searchQuery;
  const searchOpenRef = useRef(false);
  searchOpenRef.current = searchOpen;

  // The file manager's current folder competes with terminal OSC 7 reports
  // for "newest cwd wins" when a new terminal spawns.
  useEffect(() => {
    recordFileManagerCwd(cwd);
  }, [cwd]);

  useEffect(() => {
    setMoreOpen(false);
    setContextMenu(null);
  }, [visible, activeTabId]);

  useEffect(() => {
    if (!moreOpen) return;
    const items = moreMenuRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    );
    if (items?.length && initialMenuFocusRef.current) {
      items[initialMenuFocusRef.current === 'last' ? items.length - 1 : 0].focus();
    }
    initialMenuFocusRef.current = null;

    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!moreMenuRef.current?.contains(target) && !moreTriggerRef.current?.contains(target)) {
        setMoreOpen(false);
      }
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMoreOpen(false);
      moreTriggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('keydown', dismissEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('keydown', dismissEscape);
    };
  }, [moreOpen]);

  useEffect(() => {
    setHasSelection(!!activeTab?.terminal.getSelection());
    const selection = activeTab?.terminal.onSelectionChange(() => {
      setHasSelection(!!activeTab.terminal.getSelection());
    });
    return () => selection?.dispose();
  }, [activeTab]);

  // The tab the user is looking at needs no bell badge; switching to a
  // badged tab dismisses it. Stale find counts reset with the tab switch.
  const handleTabBell = useCallback((id: string) => {
    if (id === activeTabIdRef.current) return;
    setBellTabs((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  }, []);

  useEffect(() => {
    setBellTabs((prev) => omitKey(prev, activeTabId));
    setSearchResults(null);
  }, [activeTabId]);

  // A hidden panel cannot produce hover events — never strand the preview.
  useEffect(() => {
    if (!visible) hideTerminalLinkTooltip();
  }, [visible]);

  const handleTabTitle = useCallback((id: string, title: string) => {
    setTabTitles((prev) => (prev[id] === title ? prev : { ...prev, [id]: title }));
  }, []);

  const handleSearchResults = useCallback(
    (results: { index: number; count: number }) => setSearchResults(results),
    [],
  );

  const handleFontSizeChange = useCallback((size: number) => {
    writeTerminalFontSize(size);
    setPreferences((prev) => ({ ...prev, fontSize: size }));
  }, []);

  // Settings-dialog edits hot-apply: every `wisp-settings-changed` broadcast
  // (also dispatched by the ⌘± persistence writer) re-reads the preferences
  // and the effects below push them into every terminal, hidden ones included.
  useEffect(() => {
    const sync = () =>
      setPreferences((prev) => {
        const next = readPanelPreferences();
        return prev.fontSize === next.fontSize &&
          prev.fontFamily === next.fontFamily &&
          prev.copyOnSelect === next.copyOnSelect &&
          prev.ligatures === next.ligatures
          ? prev
          : next;
      });
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.SETTINGS || event.key === null) sync();
    };
    window.addEventListener('wisp-settings-changed', sync);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('wisp-settings-changed', sync);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // ── Inline find bar (⌘F/⌘E open · ⌘G/⇧⌘G and Enter/⇧Enter cycle · Esc) ──
  const runSearch = useCallback(
    (direction: 'next' | 'previous', term: string, incremental = false) => {
      const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
      if (!tab) return;
      if (!term) {
        tab.searchAddon.clearDecorations();
        setSearchResults(null);
        return;
      }
      // Ghostty default: case-insensitive substring search.
      const options = {
        caseSensitive: false,
        incremental,
        decorations: getTerminalSearchDecorations(),
      };
      if (direction === 'previous') {
        tab.searchAddon.findPrevious(term, options);
      } else {
        tab.searchAddon.findNext(term, options);
      }
    },
    [],
  );

  const openSearch = useCallback(
    (seedSelection: boolean) => {
      setSearchOpen(true);
      if (!seedSelection) return;
      const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
      const selection = tab?.terminal.getSelection() ?? '';
      if (selection) {
        setSearchQuery(selection);
        runSearch('next', selection);
      }
    },
    [runSearch],
  );

  // Cycling only acts while the bar is up — like Ghostty, ⌘G with no active
  // search does not restart one behind the user's back.
  const searchNext = useCallback(() => {
    if (!searchOpenRef.current) return;
    runSearch('next', searchQueryRef.current);
  }, [runSearch]);
  const searchPrevious = useCallback(() => {
    if (!searchOpenRef.current) return;
    runSearch('previous', searchQueryRef.current);
  }, [runSearch]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
    tab?.searchAddon.clearDecorations();
    setSearchResults(null);
    tab?.terminal.focus();
  }, []);

  const searchControls = useMemo<TerminalSearchControls>(
    () => ({ open: openSearch, next: searchNext, previous: searchPrevious }),
    [openSearch, searchNext, searchPrevious],
  );

  // Focus (and select) the query field each time the bar appears.
  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }, [searchOpen]);

  const createHooks = useMemo<CreateTabHooks>(
    () => ({
      onFontSizeChange: handleFontSizeChange,
      onSearch: searchControls,
      onCommandNotify: handleTabBell,
    }),
    [handleFontSizeChange, searchControls, handleTabBell],
  );

  // VS Code semantics: create the first terminal only on a visible transition
  // (first show, or toggling the panel back on with zero terminals). Closing
  // the last terminal while the panel stays open leaves the empty state.
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    const becameVisible = visible && !wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (!becameVisible || tabs.length > 0) return;
    const tab = createTab(undefined, undefined, createHooks);
    setTabs([tab]);
    setActiveTabId(tab.id);
    // New user tabs honor the "start read-only" preference (#42); agent-bus
    // tabs below stay interactive — they exist to be driven.
    if (readTerminalReadonlyByDefault()) {
      setReadonlyTabs((prev) => ({ ...prev, [tab.id]: true }));
    }
  }, [visible, tabs.length, createHooks]);

  // Attach tabs to CLI-agent PTY sessions launched outside this panel.
  // Drains launches that fired before this lazy panel mounted, then keeps
  // listening for new ones.
  useEffect(() => {
    const attach = (launch: CliAgentLaunch) => {
      setTabs((prev) => {
        if (prev.some((t) => t.id === launch.sessionId)) return prev;
        // The agent session's cwd is known from the launch — seed it so
        // "open in file manager" works before any OSC 7 report arrives.
        recordSpawnCwd(launch.sessionId, launch.workingDirectory);
        const tab = createTab(launch.label, launch.sessionId, createHooks);
        setActiveTabId(launch.sessionId);
        return [...prev, tab];
      });
    };

    consumePendingCliLaunches().forEach(attach);

    const onLaunched = (e: Event) => {
      attach((e as CustomEvent<CliAgentLaunch>).detail);
    };
    window.addEventListener(CLI_AGENT_LAUNCHED_EVENT, onLaunched);
    return () => {
      window.removeEventListener(CLI_AGENT_LAUNCHED_EVENT, onLaunched);
    };
  }, [createHooks]);

  // Refit and focus the active terminal whenever the panel becomes visible
  // again (switching bottom tabs / expanding the panel).
  useEffect(() => {
    if (!visible) return;
    const active = tabs.find((t) => t.id === activeTabId);
    if (!active) return;
    const keepTabFocus = keepTabFocusRef.current;
    keepTabFocusRef.current = false;
    requestAnimationFrame(() => {
      try {
        active.fitAddon.fit();
      } catch {
        /* ignore */
      }
      if (keepTabFocus) {
        document.getElementById(`terminal-tab-${active.id}`)?.focus();
      } else {
        active.terminal.focus();
      }
    });
  }, [visible, activeTabId, tabs]);

  // Listen to PTY output — route to correct terminal
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    TauriAPI.listenToPtyOutput((payload: PtyOutputPayload) => {
      // Every chunk feeds the command-completion watch's silence baseline
      // before it reaches the buffer (#22).
      notifyCommandOutput(payload.session_id);
      setTabs((prev) => {
        const tab = prev.find((t) => t.id === payload.session_id);
        if (tab) tab.terminal.write(payload.data);
        return prev;
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  // Listen to PTY exit — mark tab as exited
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    TauriAPI.listenToPtyExit((sessionId: string) => {
      markExternalAgentExited(sessionId);
      setTabs((prev) => {
        const tab = prev.find((t) => t.id === sessionId);
        if (tab) tab.terminal.writeln('\r\n[Process exited]');
        return prev;
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  // Appearance is resolved on the root class. Pointer lighting changes root.style
  // every frame and must not invalidate the terminal's color cache.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(getTerminalTheme());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    setTheme(getTerminalTheme());
    return () => observer.disconnect();
  }, []);

  // Recolor every existing terminal, including hidden tabs, without touching PTYs.
  useEffect(() => {
    tabs.forEach((tab) => {
      tab.terminal.options.theme = theme;
    });
  }, [theme, tabs]);

  // A ⌘+/⌘-/⌘0 or settings change propagates to every terminal (hidden ones
  // refit on their next show) and persists for the next panel/app launch.
  useEffect(() => {
    tabs.forEach((tab) => {
      tab.terminal.options.fontSize = fontSize;
    });
  }, [fontSize, tabs]);

  // Font-family edits hot-apply the same way — no session rebuild.
  useEffect(() => {
    tabs.forEach((tab) => {
      tab.terminal.options.fontFamily = fontFamily;
    });
  }, [fontFamily, tabs]);

  const handleAddTab = useCallback(() => {
    const tab = createTab(undefined, undefined, createHooks);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    if (readTerminalReadonlyByDefault()) {
      setReadonlyTabs((prev) => ({ ...prev, [tab.id]: true }));
    }
  }, [createHooks]);

  const handleCloseTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        // VS Code semantics: closing the last terminal leaves an empty state;
        // a new one is only created when the panel is toggled on again.
        if (id === activeTabId) {
          setActiveTabId(next[next.length - 1]?.id ?? '');
        }
        return next;
      });
      setTabTitles((prev) => omitKey(prev, id));
      setReadonlyTabs((prev) => omitKey(prev, id));
      setBellTabs((prev) => omitKey(prev, id));
    },
    [activeTabId],
  );

  // Right-click on a terminal surface: navigate the file manager to that
  // session's latest OSC 7 cwd (falls back to its spawn directory).
  const handleTerminalContextMenu = useCallback((tab: TermTab, event: React.MouseEvent) => {
    event.preventDefault();
    setMoreOpen(false);
    setContextMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
  }, []);

  const openSessionInFileManager = useCallback(
    (sessionId: string) => {
      const sessionCwd = getSessionCwd(sessionId);
      if (!sessionCwd || !onNavigate) return;
      onNavigate(sessionCwd);
    },
    [onNavigate],
  );

  const contextMenuItems = useMemo<TerminalContextMenuItem[]>(() => {
    if (!contextMenu) return [];
    const sessionCwd = getSessionCwd(contextMenu.tabId);
    return [
      {
        key: 'open-in-file-manager',
        label: i18n.t('xterm.openInFileManager', { defaultValue: '在文件管理器中打开' }),
        disabled: !sessionCwd || !onNavigate,
        onSelect: () => openSessionInFileManager(contextMenu.tabId),
      },
    ];
  }, [contextMenu, onNavigate, openSessionInFileManager]);

  const toggleReadonly = () => {
    if (!activeTab) return;
    setMoreOpen(false);
    const id = activeTab.id;
    setReadonlyTabs((prev) => ({ ...prev, [id]: !prev[id] }));
    activeTab.terminal.focus();
  };

  const handleClipboard = (action: 'copy' | 'paste') => {
    if (!activeTab) return;
    setMoreOpen(false);
    void editTerminalClipboard(activeTab.terminal, action).catch(() =>
      reportClipboardError(action),
    );
  };
  const copyLabel = i18n.t('common.copy');
  const pasteLabel = i18n.t('common.paste');
  const clearLabel = i18n.t('xterm.clearScreen', { defaultValue: '清屏' });
  const closeLabel = i18n.t('common.close');
  const moreLabel = i18n.t('xterm.moreActions', { defaultValue: '终端操作' });
  const readonlyLabel = i18n.t('xterm.readonly', { defaultValue: '只读' });
  const findPlaceholder = i18n.t('xterm.findPlaceholder', { defaultValue: '在终端中查找' });
  const findNextLabel = i18n.t('xterm.findNext', { defaultValue: '下一个匹配' });
  const findPreviousLabel = i18n.t('xterm.findPrevious', { defaultValue: '上一个匹配' });
  const findCloseLabel = i18n.t('xterm.findClose', { defaultValue: '关闭搜索' });
  const noResultsLabel = i18n.t('xterm.findNoResults', { defaultValue: '无结果' });
  const contextMenuLabel = i18n.t('xterm.contextMenu', { defaultValue: '终端快捷菜单' });
  const shortcutPrefix = isMacPlatform() ? '⌘' : 'Ctrl+Shift+';
  const activeReadonly = !!activeTab && !!readonlyTabs[activeTab.id];
  const resultsLabel = findResultsLabel(searchResults, noResultsLabel);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      moreMenuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? [],
    );
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      let next = (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = items.length - 1;
      items[next]?.focus();
    }
    if (event.key === 'Tab') {
      // Put focus back at the trigger before the browser advances Tab in
      // document order. The menu portal must not jump to the end of the page.
      moreTriggerRef.current?.focus();
      setMoreOpen(false);
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const target = event.target as HTMLElement;
    if (target.getAttribute('role') !== 'tab') return;
    const index = tabs.findIndex((tab) => target.id === `terminal-tab-${tab.id}`);
    if (index < 0) return;
    let nextIndex = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    event.preventDefault();
    if (tabs[nextIndex].id === activeTabId) {
      target.focus();
      return;
    }
    keepTabFocusRef.current = true;
    setActiveTabId(tabs[nextIndex].id);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        searchPrevious();
      } else {
        searchNext();
      }
    }
  };

  // The panel is kept mounted (hidden) by BottomPanel when inactive or
  // collapsed — never return null here, that would destroy the sessions.

  return (
    <div
      className={`wisp-terminal-panel${ligatures ? ' wisp-terminal-ligatures' : ''}`}
      style={
        {
          '--wisp-terminal-bg': theme.background,
          '--wisp-terminal-fg': theme.foreground,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        } as CSSProperties
      }
    >
      {/* Tab bar */}
      <div className="wisp-terminal-tabbar wisp-bottom-subtoolbar">
        <div
          className="wisp-terminal-tablist"
          role="tablist"
          aria-label={i18n.t('bottomPanel.terminal')}
          onKeyDown={handleTabKeyDown}
        >
          {tabs.map((tab) => {
            const displayLabel = tabTitles[tab.id] ?? tab.label;
            return (
              <div
                key={tab.id}
                className="wisp-terminal-session-tab"
                data-active={tab.id === activeTabId}
              >
                <button
                  type="button"
                  role="tab"
                  id={`terminal-tab-${tab.id}`}
                  aria-selected={tab.id === activeTabId}
                  aria-controls={`terminal-session-${tab.id}`}
                  tabIndex={tab.id === activeTabId ? 0 : -1}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  {bellTabs[tab.id] && (
                    <Bell size={10} className="wisp-terminal-tab-bell" aria-hidden="true" />
                  )}
                  {readonlyTabs[tab.id] && (
                    <Lock size={10} className="wisp-terminal-tab-lock" aria-hidden="true" />
                  )}
                  <span>{displayLabel}</span>
                </button>
                <button
                  type="button"
                  className="wisp-terminal-close"
                  onClick={() => handleCloseTab(tab.id)}
                  aria-label={`${closeLabel} ${displayLabel}`}
                  title={`${closeLabel} ${displayLabel}`}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="wisp-terminal-actions">
          <button
            type="button"
            onClick={handleAddTab}
            aria-label={i18n.t('xterm.newTerminal')}
            title={i18n.t('xterm.newTerminal')}
          >
            <Plus size={15} aria-hidden="true" />
          </button>
          <button
            ref={moreTriggerRef}
            type="button"
            aria-label={moreLabel}
            title={moreLabel}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            disabled={!activeTab}
            onClick={(event) => {
              initialMenuFocusRef.current = event.detail === 0 ? 'first' : null;
              setMoreOpen(!moreOpen);
            }}
            onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
              event.preventDefault();
              if (moreOpen) {
                const items = moreMenuRef.current?.querySelectorAll<HTMLButtonElement>(
                  '[role="menuitem"]:not(:disabled)',
                );
                if (items?.length) items[event.key === 'ArrowUp' ? items.length - 1 : 0].focus();
                return;
              }
              initialMenuFocusRef.current = event.key === 'ArrowUp' ? 'last' : 'first';
              setMoreOpen(true);
            }}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {moreOpen && (
        <AnchoredMenu
          anchorRef={moreTriggerRef}
          menuRef={moreMenuRef}
          role="menu"
          aria-label={moreLabel}
          className="wisp-terminal-menu"
          onKeyDown={handleMenuKeyDown}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={!hasSelection}
            onClick={() => handleClipboard('copy')}
          >
            <span>{copyLabel}</span>
            <kbd>{shortcutPrefix}C</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => handleClipboard('paste')}
          >
            <span>{pasteLabel}</span>
            <kbd>{shortcutPrefix}V</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              setMoreOpen(false);
              activeTab?.terminal.clear();
              activeTab?.terminal.focus();
            }}
          >
            <span>{clearLabel}</span>
            {isMacPlatform() && <kbd>⌘K</kbd>}
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-checked={activeReadonly}
            onClick={toggleReadonly}
          >
            <span>{readonlyLabel}</span>
            {activeReadonly && <Check size={13} aria-hidden="true" />}
          </button>
        </AnchoredMenu>
      )}

      {contextMenu && contextMenuItems.length > 0 && (
        <TerminalContextMenu
          point={{ x: contextMenu.x, y: contextMenu.y }}
          items={contextMenuItems}
          menuLabel={contextMenuLabel}
          onDismiss={() => setContextMenu(null)}
        />
      )}

      {/* Terminal instances */}
      <div
        className="wisp-terminal-sessions"
        style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
      >
        {searchOpen && (
          <div className="wisp-terminal-searchbar" role="search">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              placeholder={findPlaceholder}
              aria-label={findPlaceholder}
              spellCheck={false}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                runSearch('next', event.target.value, true);
              }}
              onKeyDown={handleSearchKeyDown}
            />
            <span className="wisp-terminal-search-count" aria-live="polite">
              {resultsLabel}
            </span>
            <button
              type="button"
              onClick={searchPrevious}
              aria-label={findPreviousLabel}
              title={findPreviousLabel}
              disabled={!searchQuery}
            >
              <ChevronUp size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={searchNext}
              aria-label={findNextLabel}
              title={findNextLabel}
              disabled={!searchQuery}
            >
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={closeSearch}
              aria-label={findCloseLabel}
              title={findCloseLabel}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        )}
        {tabs.map((tab) => (
          <TermInstance
            key={tab.id}
            tab={tab}
            cwd={cwd}
            isActive={visible && tab.id === activeTabId}
            readonly={!!readonlyTabs[tab.id]}
            copyOnSelect={copyOnSelect}
            onTitle={handleTabTitle}
            onBell={handleTabBell}
            onSearchResults={handleSearchResults}
            onContextMenu={handleTerminalContextMenu}
          />
        ))}
      </div>
    </div>
  );
};

export default XTermPanel;
