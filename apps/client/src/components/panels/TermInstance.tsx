import { useRef, useEffect } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { SearchAddon } from '@xterm/addon-search';
import type { Terminal } from '@xterm/xterm';
import {
  editTerminalClipboard,
  trimCopiedTerminalText,
  type TerminalSearchControls,
} from '@/lib/terminal-input';
import {
  forgetSession,
  pickTerminalSpawnCwd,
  recordSessionActivity,
  recordSpawnCwd,
  type ShellIntegrationHandle,
} from '@/lib/terminal-shell-integration';
import { forgetCommandWatch, notifyCommandInput } from '@/lib/terminal-command-badge';
import {
  readTerminalBellEnabled,
  readTerminalEnvVars,
  readTerminalShell,
} from '@/lib/terminal-settings';
import { TauriAPI } from '@/lib/tauri-api';
import { hideTerminalLinkTooltip, moveTerminalLinkTooltip } from '@/lib/terminal-link-tooltip';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TermTab {
  id: string;
  label: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  /** OSC 7 / OSC 133 tracking for this session (cwd, prompt marks). */
  integration: ShellIntegrationHandle;
  /** True when the PTY session was spawned elsewhere (CLI agent launcher)
   *  and this tab merely attaches to it — do not spawn again on mount. */
  attached?: boolean;
}

export interface CreateTabHooks {
  onFontSizeChange?: (size: number) => void;
  onSearch?: TerminalSearchControls;
  /** A command outlasted the completion threshold in this session (#22). */
  onCommandNotify?: (sessionId: string) => void;
}

interface TermInstanceProps {
  tab: TermTab;
  cwd: string;
  isActive: boolean;
  readonly: boolean;
  copyOnSelect: boolean;
  onTitle: (id: string, title: string) => void;
  onBell: (id: string) => void;
  onSearchResults: (results: { index: number; count: number }) => void;
  onContextMenu?: (tab: TermTab, event: React.MouseEvent) => void;
}

const COPY_ON_SELECT_DEBOUNCE_MS = 150;

// ── Single terminal instance ─────────────────────────────────────────────────

const TermInstance = ({
  tab,
  cwd,
  isActive,
  readonly,
  copyOnSelect,
  onTitle,
  onBell,
  onSearchResults,
  onContextMenu,
}: TermInstanceProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const spawnedRef = useRef(false);
  // Capture cwd at mount time so the spawn effect doesn't depend on it.
  // Terminal sessions are independent of folder navigation — they should
  // never be killed just because the user browses to a different directory.
  const initialCwdRef = useRef(cwd);
  // Live flags for handlers subscribed once per terminal.
  const readonlyRef = useRef(readonly);
  readonlyRef.current = readonly;
  const copyOnSelectRef = useRef(copyOnSelect);
  copyOnSelectRef.current = copyOnSelect;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const copyTimerRef = useRef(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    tab.terminal.open(container);
    tab.fitAddon.fit();

    // Follow the cursor while a link preview is visible.
    const onMouseMove = (event: MouseEvent) => {
      moveTerminalLinkTooltip(event.clientX, event.clientY);
    };
    // Ghostty-style copy trim for the macOS responder path: whatever the
    // system copy event delivered, rewrite it with the trimmed selection.
    const onCopy = (event: ClipboardEvent) => {
      const selection = tab.terminal.getSelection();
      if (!selection || !event.clipboardData) return;
      event.clipboardData.setData('text/plain', trimCopiedTerminalText(selection));
    };
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('copy', onCopy);

    return () => {
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('copy', onCopy);
      hideTerminalLinkTooltip();
      tab.terminal.dispose();
    };
  }, [tab]);

  useEffect(() => {
    if (spawnedRef.current) return;
    spawnedRef.current = true;

    // Attached tabs wire into an already-running PTY (spawned by the CLI
    // agent launcher) — only fresh tabs spawn their own session. A fresh
    // session starts in the newest of: the most recently active terminal's
    // OSC 7 cwd, or the file manager's current folder.
    if (!tab.attached) {
      const cols = tab.terminal.cols || 80;
      const rows = tab.terminal.rows || 24;
      const spawnCwd = pickTerminalSpawnCwd(initialCwdRef.current);
      recordSpawnCwd(tab.id, spawnCwd);
      // Shell + extra env come from the terminal settings (#45): the custom
      // shell wins, an empty value leaves the Rust side to resolve $SHELL.
      const customShell = readTerminalShell();
      TauriAPI.ptySpawn(
        tab.id,
        spawnCwd,
        cols,
        rows,
        customShell || undefined,
        readTerminalEnvVars(),
      ).catch((err) => {
        console.error(`[XTerm] Failed to spawn PTY ${tab.id}:`, err);
        tab.terminal.writeln(`\r\nFailed to start terminal: ${err}`);
      });
    }

    const input = tab.terminal.onData((data) => {
      // Read-only tabs swallow keyboard input (paste included — it flows
      // through onData) while copy, search and scrollback stay available.
      if (readonlyRef.current) return;
      recordSessionActivity(tab.id);
      // Swallowed input never started a command — only real keystrokes feed
      // the completion watch's silence baseline (#22).
      notifyCommandInput(tab.id);
      // First keystroke at a prompt: end the OSC 133 cursor morph.
      tab.integration.handleUserInput();
      TauriAPI.ptyWrite(tab.id, data).catch(() => {});
    });

    return () => {
      input.dispose();
      forgetSession(tab.id);
      forgetCommandWatch(tab.id);
      TauriAPI.ptyKill(tab.id).catch(() => {});
    };
  }, [tab]);

  // The focused tab is the "most recently active terminal" for the
  // new-terminal spawn directory.
  useEffect(() => {
    if (isActive) recordSessionActivity(tab.id);
  }, [isActive, tab.id]);

  // OSC 0/2 title tracking — vim/ssh sessions rename their tab live.
  useEffect(() => {
    const titleChange = tab.terminal.onTitleChange((title) => {
      if (title) onTitle(tab.id, title);
    });
    return () => titleChange.dispose();
  }, [tab, onTitle]);

  // Bell alerts stay silent until the user opts in (#30 → #42 toggle); the
  // setting is read at ring time so flipping it needs no terminal rebuild.
  useEffect(() => {
    const bell = tab.terminal.onBell(() => {
      if (readTerminalBellEnabled()) onBell(tab.id);
    });
    return () => bell.dispose();
  }, [tab, onBell]);

  // Copy-on-select (Ghostty default): debounced so dragging a selection does
  // not hammer the clipboard while it extends.
  useEffect(() => {
    const selection = tab.terminal.onSelectionChange(() => {
      if (!copyOnSelectRef.current || !tab.terminal.getSelection()) return;
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => {
        void editTerminalClipboard(tab.terminal, 'copy').catch(() => {});
      }, COPY_ON_SELECT_DEBOUNCE_MS);
    });
    return () => {
      selection.dispose();
      window.clearTimeout(copyTimerRef.current);
    };
  }, [tab]);

  // Feed the find bar with match counts from the visible terminal only.
  useEffect(() => {
    const results = tab.searchAddon.onDidChangeResults((event) => {
      if (isActiveRef.current) {
        onSearchResults({ index: event.resultIndex, count: event.resultCount });
      }
    });
    return () => results.dispose();
  }, [tab, onSearchResults]);

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
      id={`terminal-session-${tab.id}`}
      role="tabpanel"
      aria-labelledby={`terminal-tab-${tab.id}`}
      onContextMenu={(event) => onContextMenu?.(tab, event)}
      style={{
        width: '100%',
        height: '100%',
        display: isActive ? 'block' : 'none',
      }}
    />
  );
};

export default TermInstance;
