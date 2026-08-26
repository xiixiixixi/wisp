import i18n from '@/i18n';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { TauriAPI } from '@/lib/tauri-api';
import type { PtyOutputPayload } from '@/lib/tauri-api/pty';
import {
  CLI_AGENT_LAUNCHED_EVENT,
  consumePendingCliLaunches,
  type CliAgentLaunch,
} from './agent-manager/cli-launch-bus';
import { Plus, X, Terminal as TerminalIcon } from 'lucide-react';

import '@xterm/xterm/css/xterm.css';

// ── Types ────────────────────────────────────────────────────────────────────

interface TermTab {
  id: string;
  label: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  /** True when the PTY session was spawned elsewhere (CLI agent launcher)
   *  and this tab merely attaches to it — do not spawn again on mount. */
  attached?: boolean;
}

interface XTermPanelProps {
  cwd: string;
  /** Whether the terminal is currently shown (VS Code semantics: the first
   *  terminal is created lazily on first show, then kept alive forever). */
  visible?: boolean;
}

// ── Theme helper ─────────────────────────────────────────────────────────────

const getCssVar = (name: string, fallback: string): string => {
  if (typeof document === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
};

const getTermTheme = () => ({
  background: getCssVar('--xp-bg', '#1a1b26'),
  foreground: getCssVar('--xp-text', '#c0caf5'),
  cursor: getCssVar('--xp-blue', '#7aa2f7'),
  cursorAccent: getCssVar('--xp-bg', '#1a1b26'),
  selectionBackground: 'rgba(122, 162, 247, 0.3)',
  black: '#15161e',
  red: getCssVar('--xp-red', '#f7768e'),
  green: getCssVar('--xp-green', '#9ece6a'),
  yellow: getCssVar('--xp-orange', '#e0af68'),
  blue: getCssVar('--xp-blue', '#7aa2f7'),
  magenta: getCssVar('--xp-pink', '#bb9af7'),
  cyan: getCssVar('--xp-cyan', '#7dcfff'),
  white: getCssVar('--xp-text', '#c0caf5'),
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5',
});

// ── Single terminal instance ─────────────────────────────────────────────────

const TermInstance = ({ tab, cwd, isActive }: { tab: TermTab; cwd: string; isActive: boolean }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const spawnedRef = useRef(false);
  // Capture cwd at mount time so the spawn effect doesn't depend on it.
  // Terminal sessions are independent of folder navigation — they should
  // never be killed just because the user browses to a different directory.
  const initialCwdRef = useRef(cwd);

  useEffect(() => {
    if (!containerRef.current) return;
    tab.terminal.open(containerRef.current);
    tab.fitAddon.fit();

    return () => {
      tab.terminal.dispose();
    };
  }, [tab]);

  useEffect(() => {
    if (!isActive) return;
    requestAnimationFrame(() => {
      tab.fitAddon.fit();
      tab.terminal.focus();
    });
  }, [isActive, tab]);

  useEffect(() => {
    if (spawnedRef.current) return;
    spawnedRef.current = true;

    // Attached tabs wire into an already-running PTY (spawned by the CLI
    // agent launcher) — only fresh tabs spawn their own session.
    if (!tab.attached) {
      const cols = tab.terminal.cols || 80;
      const rows = tab.terminal.rows || 24;

      TauriAPI.ptySpawn(tab.id, initialCwdRef.current, cols, rows).catch((err) => {
        console.error(`[XTerm] Failed to spawn PTY ${tab.id}:`, err);
        tab.terminal.writeln(`\r\nFailed to start terminal: ${err}`);
      });
    }

    tab.terminal.onData((data) => {
      TauriAPI.ptyWrite(tab.id, data).catch(() => {});
    });

    return () => {
      TauriAPI.ptyKill(tab.id).catch(() => {});
    };
  }, [tab]);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const observer = new ResizeObserver(() => {
      // Skip degenerate sizes while the panel is hidden (display: none)
      if (!containerRef.current?.clientWidth || !containerRef.current?.clientHeight) return;
      try {
        tab.fitAddon.fit();
        TauriAPI.ptyResize(tab.id, tab.terminal.cols, tab.terminal.rows).catch(() => {});
      } catch {
        /* ignore */
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isActive, tab]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: isActive ? 'block' : 'none',
      }}
    />
  );
};

// ── Multi-tab panel ──────────────────────────────────────────────────────────

let tabCounter = 0;

const createTab = (label?: string, attachSessionId?: string): TermTab => {
  tabCounter++;
  const id = attachSessionId ?? `pty-${Date.now()}-${tabCounter}`;
  const theme = getTermTheme();
  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", Menlo, monospace',
    lineHeight: 1.3,
    theme,
    allowProposedApi: true,
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  return {
    id,
    label: label ?? `Terminal ${tabCounter}`,
    terminal,
    fitAddon,
    attached: attachSessionId !== undefined,
  };
};

const XTermPanel = ({ cwd, visible = true }: XTermPanelProps) => {
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [activeTabId, setActiveTabId] = useState('');

  // VS Code semantics: create the first terminal only on a visible transition
  // (first show, or toggling the panel back on with zero terminals). Closing
  // the last terminal while the panel stays open leaves the empty state.
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    const becameVisible = visible && !wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (!becameVisible || tabs.length > 0) return;
    const tab = createTab();
    setTabs([tab]);
    setActiveTabId(tab.id);
  }, [visible, tabs.length]);

  // Attach tabs to CLI-agent PTY sessions launched outside this panel
  // (NewAgentForm). Drains launches that fired before this lazy panel
  // mounted, then keeps listening for new ones.
  useEffect(() => {
    const attach = (launch: CliAgentLaunch) => {
      setTabs((prev) => {
        if (prev.some((t) => t.id === launch.sessionId)) return prev;
        const tab = createTab(launch.label, launch.sessionId);
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
  }, []);

  // Refit and focus the active terminal whenever the panel becomes visible
  // again (switching bottom tabs / expanding the panel).
  useEffect(() => {
    if (!visible) return;
    const active = tabs.find((t) => t.id === activeTabId);
    if (!active) return;
    requestAnimationFrame(() => {
      try {
        active.fitAddon.fit();
      } catch {
        /* ignore */
      }
      active.terminal.focus();
    });
  }, [visible, activeTabId, tabs]);

  // Listen to PTY output — route to correct terminal
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    TauriAPI.listenToPtyOutput((payload: PtyOutputPayload) => {
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

  // Update theme when CSS variables change (theme switch)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const theme = getTermTheme();
      tabs.forEach((tab) => {
        tab.terminal.options.theme = theme;
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    return () => observer.disconnect();
  }, [tabs]);

  const handleAddTab = useCallback(() => {
    const tab = createTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const handleCloseTab = useCallback(
    (id: string) => {
      TauriAPI.ptyKill(id).catch(() => {});
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        // VS Code semantics: closing the last terminal leaves an empty state;
        // a new one is only created when the panel is toggled on again.
        if (id === activeTabId) {
          setActiveTabId(next[next.length - 1]?.id ?? '');
        }
        return next;
      });
    },
    [activeTabId],
  );

  // The panel is kept mounted (hidden) by BottomPanel when inactive or
  // collapsed — never return null here, that would destroy the sessions.

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: getCssVar('--xp-bg', '#1a1b26'),
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 32,
          minHeight: 32,
          borderBottom: `1px solid ${getCssVar('--xp-border', 'rgba(41,46,66,0.5)')}`,
          backgroundColor: getCssVar('--xp-surface', 'rgba(26,27,38,0.8)'),
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', flex: 1, overflow: 'auto', gap: 1 }}>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 10px',
                height: 32,
                fontSize: 11,
                cursor: 'pointer',
                color:
                  tab.id === activeTabId
                    ? getCssVar('--xp-text', '#c0caf5')
                    : getCssVar('--xp-text-muted', '#565f89'),
                backgroundColor:
                  tab.id === activeTabId ? getCssVar('--xp-bg', '#1a1b26') : 'transparent',
                borderBottom:
                  tab.id === activeTabId
                    ? `1px solid ${getCssVar('--xp-blue', '#7aa2f7')}`
                    : '1px solid transparent',
                whiteSpace: 'nowrap',
                transition: 'all 0.1s',
              }}
            >
              <TerminalIcon size={12} />
              <span>{tab.label}</span>
              {/* Always closable, like VS Code's per-terminal kill button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(tab.id);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  border: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  opacity: 0.5,
                  padding: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '1';
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '0.5';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>

        {/* Add tab button */}
        <button
          onClick={handleAddTab}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            marginRight: 4,
            border: 'none',
            borderRadius: 4,
            background: 'transparent',
            color: getCssVar('--xp-text-muted', '#565f89'),
            cursor: 'pointer',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          title={i18n.t('xterm.newTerminal')}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Terminal instances */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {tabs.length === 0 ? (
          <div
            style={{
              display: 'flex',
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              color: getCssVar('--xp-text-muted', '#565f89'),
            }}
          >
            {i18n.t('xterm.noTerminals')}
          </div>
        ) : (
          tabs.map((tab) => (
            <TermInstance key={tab.id} tab={tab} cwd={cwd} isActive={tab.id === activeTabId} />
          ))
        )}
      </div>
    </div>
  );
};

export default XTermPanel;
