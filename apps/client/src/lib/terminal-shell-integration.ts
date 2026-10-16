/**
 * Shell-integration frontend: parses the OSC 7 (cwd) and OSC 133 (prompt /
 * command marks) sequences emitted by the rc snippets Wisp injects at PTY
 * spawn (see `apps/src-tauri/src/shell_integration.rs`), tracks them per
 * terminal session, and powers the user-facing features:
 *
 * - OSC 7 → per-session cwd, consumed by "open in file manager" navigation
 *   and by the new-terminal spawn directory ("whichever changed last wins":
 *   the most recently active terminal's cwd vs the file manager's path).
 * - OSC 133 A → prompt lines (⌘↑/⌘↓ jump) and the prompt cursor morph
 *   (block at the prompt, back to bar on the first keystroke).
 */
import type { Terminal } from '@xterm/xterm';

// ── OSC 7: cwd reporting ─────────────────────────────────────────────────────

/**
 * Extract the local directory from an OSC 7 payload.
 *
 * Wisp's injected hooks emit hostless `file://<absolute-path>` URIs, and only
 * those are trusted: a payload that carries a hostname (`file://host/path`,
 * `kitty-shell-cwd://host/path`) comes from a remote or third-party shell
 * integration whose paths do not exist on this machine.
 */
export const parseOsc7Cwd = (payload: string): string | null => {
  if (!payload.startsWith('file://')) return null;
  const rest = payload.slice('file://'.length);
  // A leading slash means an empty authority (no host): a local path.
  if (!rest.startsWith('/')) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    // Malformed percent-escape: keep the raw path rather than losing the cd.
    return rest;
  }
};

// ── OSC 133: prompt/command marks ────────────────────────────────────────────

/** Shell states as delimited by OSC 133 marks. */
export type ShellPhase = 'idle' | 'prompt' | 'input' | 'running';

export interface ShellPhaseState {
  phase: ShellPhase;
  /** Buffer line numbers where a prompt started, oldest first. */
  promptLines: number[];
}

/** Marks are tiny; keeping the most recent prompts is plenty for ⌘↑/⌘↓. */
export const MAX_PROMPT_MARKS = 500;

export const initialShellPhase = (): ShellPhaseState => ({
  phase: 'idle',
  promptLines: [],
});

export interface ShellPhaseEvent {
  kind: 'A' | 'B' | 'C' | 'D';
  /** Buffer line of the mark; captured by the caller for A (prompt start). */
  line?: number;
  /** Exit status carried by D marks. */
  exitCode?: number;
}

/**
 * Parse an OSC 133 payload (`A`, `C`, `D;0`, `A;cl=line`, …). Unsupported
 * FinalTerm commands (P, E) yield null so their sequences pass through.
 */
export const parseOsc133Event = (payload: string): ShellPhaseEvent | null => {
  const semicolon = payload.indexOf(';');
  const kind = semicolon === -1 ? payload : payload.slice(0, semicolon);
  if (kind === 'A' || kind === 'B' || kind === 'C') return { kind };
  if (kind === 'D') {
    const params = semicolon === -1 ? '' : payload.slice(semicolon + 1);
    const exitCode = Number.parseInt(params, 10);
    return Number.isNaN(exitCode) ? { kind } : { kind, exitCode };
  }
  return null;
};

/** Pure state transition for OSC 133 marks. */
export const reduceShellPhase = (
  state: ShellPhaseState,
  event: ShellPhaseEvent,
): ShellPhaseState => {
  switch (event.kind) {
    case 'A': {
      // A redrawn prompt (reset-prompt, SIGWINCH) repeats the same line —
      // record it once.
      const line = event.line;
      const last = state.promptLines[state.promptLines.length - 1];
      const promptLines =
        typeof line === 'number' && line >= 0 && line !== last
          ? [...state.promptLines, line].slice(-MAX_PROMPT_MARKS)
          : state.promptLines;
      return { phase: 'prompt', promptLines };
    }
    case 'B':
      return state.phase === 'prompt' ? { ...state, phase: 'input' } : state;
    case 'C':
      return { ...state, phase: 'running' };
    case 'D':
      return { ...state, phase: 'idle' };
  }
};

// ── Session cwd store ────────────────────────────────────────────────────────

interface SessionRecord {
  /** Directory the session spawned in (fallback until OSC 7 reports). */
  spawnCwd: string;
  /** Latest known cwd (spawn dir, then OSC 7 reports). */
  cwd: string;
  /** When OSC 7 last reported a cwd; 0 = never. */
  osc7At: number;
  /** When the user last interacted with this session (focus, typing). */
  lastActiveAt: number;
}

/**
 * Module-level by design: the panel remounts across sessions but the
 * "newest cwd wins" spawn decision spans every session, including tabs the
 * CLI-agent bus attached from outside the panel.
 */
const sessions = new Map<string, SessionRecord>();
const fileManager = { cwd: '', updatedAt: 0 };

const now = () => Date.now();

/** Seed a session with its spawn directory (right-click fallback cwd). */
export const recordSpawnCwd = (sessionId: string, cwd: string): void => {
  const existing = sessions.get(sessionId);
  sessions.set(sessionId, {
    spawnCwd: cwd,
    cwd: existing?.cwd ?? cwd,
    osc7At: existing?.osc7At ?? 0,
    lastActiveAt: existing?.lastActiveAt ?? now(),
  });
};

/** Trust an OSC 7 report as the session's current directory. */
export const recordOsc7Cwd = (sessionId: string, cwd: string): void => {
  const existing = sessions.get(sessionId);
  sessions.set(sessionId, {
    spawnCwd: existing?.spawnCwd ?? cwd,
    cwd,
    osc7At: now(),
    lastActiveAt: existing?.lastActiveAt ?? now(),
  });
};

/** Mark a session as the one the user is working in (focus, keystrokes). */
export const recordSessionActivity = (sessionId: string): void => {
  const existing = sessions.get(sessionId);
  if (!existing) return;
  sessions.set(sessionId, { ...existing, lastActiveAt: now() });
};

/** Record the file manager's current folder (only real navigations count). */
export const recordFileManagerCwd = (cwd: string): void => {
  if (!cwd || cwd === fileManager.cwd) return;
  fileManager.cwd = cwd;
  fileManager.updatedAt = now();
};

/** The session's latest known directory, or null for unknown sessions. */
export const getSessionCwd = (sessionId: string): string | null =>
  sessions.get(sessionId)?.cwd ?? null;

export const forgetSession = (sessionId: string): void => {
  sessions.delete(sessionId);
};

/**
 * Where a new terminal should start: the newer of the most recently active
 * terminal's OSC 7 cwd and the file manager's current path. The fallback
 * covers the very first spawn, which happens before the panel has recorded
 * any navigation.
 */
export const pickTerminalSpawnCwd = (fallback: string): string => {
  let candidate: SessionRecord | null = null;
  for (const record of sessions.values()) {
    if (record.osc7At === 0) continue;
    if (!candidate || record.lastActiveAt > candidate.lastActiveAt) candidate = record;
  }
  const managerCwd = fileManager.cwd || fallback;
  if (candidate && candidate.osc7At > fileManager.updatedAt) return candidate.cwd;
  return managerCwd;
};

/** Test isolation: wipe every tracked session and navigation timestamp. */
export const resetShellIntegrationStore = (): void => {
  sessions.clear();
  fileManager.cwd = '';
  fileManager.updatedAt = 0;
};

// ── Per-terminal controller ──────────────────────────────────────────────────

export type PromptJumpDirection = 'previous' | 'next';

export interface ShellIntegrationOptions {
  /** Style to restore after the prompt morph; matches the panel default. */
  baseCursorStyle?: 'block' | 'underline' | 'bar';
  /** OSC 133;C — the shell started executing a command (#22 watch). */
  onCommandStart?: () => void;
  /** OSC 133;D — the shell returned to its prompt (#22 watch). */
  onCommandFinish?: () => void;
}

export interface ShellIntegrationHandle {
  dispose(): void;
  /** ⌘↑/⌘↓ between recorded prompts, anchored at the viewport; false (and
   *  no scroll) when no usable mark exists in that direction. */
  jumpToPrompt(direction: PromptJumpDirection): boolean;
  /** First keystroke at a prompt: morph the cursor back to its base style. */
  handleUserInput(): void;
  /** Recorded prompt marks, oldest first (diagnostics/future UI). */
  readonly promptLines: readonly number[];
}

type IntegrationTerminal = Pick<
  Terminal,
  'parser' | 'options' | 'buffer' | 'scrollToLine' | 'scrollToBottom'
>;

/**
 * Register the OSC 7 / OSC 133 handlers on a terminal. Handlers run while
 * xterm parses output, so the buffer cursor position at the OSC 133;A mark
 * is exactly the line where the prompt starts.
 */
export const attachShellIntegration = (
  terminal: IntegrationTerminal,
  sessionId: string,
  options: ShellIntegrationOptions = {},
): ShellIntegrationHandle => {
  const baseStyle = options.baseCursorStyle ?? 'bar';
  let state = initialShellPhase();
  let cursorMorphed = false;

  const currentLine = () => {
    const buffer = terminal.buffer.active;
    return buffer.baseY + buffer.cursorY;
  };
  const restoreCursor = () => {
    if (!cursorMorphed) return;
    cursorMorphed = false;
    terminal.options.cursorStyle = baseStyle;
  };

  const osc7 = terminal.parser.registerOscHandler(7, (data) => {
    const cwd = parseOsc7Cwd(data);
    if (cwd === null) return false;
    recordOsc7Cwd(sessionId, cwd);
    return true;
  });
  const osc133 = terminal.parser.registerOscHandler(133, (data) => {
    const event = parseOsc133Event(data);
    if (!event) return false;
    if (event.kind === 'A') event.line = currentLine();
    state = reduceShellPhase(state, event);
    if (event.kind === 'A') {
      cursorMorphed = true;
      terminal.options.cursorStyle = 'block';
    }
    if (event.kind === 'C') {
      restoreCursor();
      options.onCommandStart?.();
    }
    if (event.kind === 'D') options.onCommandFinish?.();
    return true;
  });

  return {
    dispose: () => {
      osc7.dispose();
      osc133.dispose();
    },
    handleUserInput: () => {
      if (state.phase === 'prompt') restoreCursor();
    },
    jumpToPrompt: (direction) => {
      const lines = state.promptLines;
      if (lines.length === 0) return false;
      const buffer = terminal.buffer.active;
      // Buffer line numbers shift when the scrollback limit trims old lines;
      // marks that drifted past the buffer are skipped.
      const lastLine = buffer.length - 1;
      const inRange = lines.filter((line) => line <= lastLine);
      // Anchored at the viewport top (not the buffer cursor, which scrolling
      // never moves) so repeated ⌘↑/⌘↓ walk through the prompt history.
      const anchor = buffer.viewportY;
      if (direction === 'previous') {
        const target = inRange.filter((line) => line < anchor).pop();
        if (target === undefined) return false;
        terminal.scrollToLine(Math.max(0, target));
        return true;
      }
      const target = inRange.find((line) => line > anchor);
      if (target === undefined) return false;
      // The newest mark is the live prompt: land at the bottom, in context.
      if (target === inRange[inRange.length - 1]) {
        terminal.scrollToBottom();
      } else {
        terminal.scrollToLine(Math.max(0, target));
      }
      return true;
    },
    get promptLines() {
      return state.promptLines;
    },
  };
};
