/**
 * Command-completion badge (#22): badge a background tab with 🔔 when a
 * command that ran longer than the configured threshold finishes.
 *
 * Two detection sources, in priority order:
 *
 * 1. **OSC 133 marks** (authoritative, emitted by the injected shell
 *    integration, see terminal-shell-integration.ts): `C` starts a command,
 *    `D` finishes it — the finish decides from the C→D duration.
 * 2. **Silence heuristic** (shells without integration): output arriving
 *    after ≥ threshold with no prior activity (input or output) is read as
 *    "a long command just returned to its prompt". The baseline resets on
 *    every keystroke, so typing at an idle prompt never badges.
 *
 * While a C mark owns the current command the heuristic stays suppressed, so
 * the two paths never double-fire on one command.
 */
import { readTerminalCommandNotifySeconds } from '@/lib/terminal-settings';

export type CommandWatchEvent =
  | { type: 'input'; at: number }
  | { type: 'output'; at: number }
  | { type: 'command-start'; at: number }
  | { type: 'command-finish'; at: number };

export interface CommandWatchState {
  /** Last user input or PTY output; 0 = nothing observed yet. */
  lastActivityAt: number;
  /** OSC 133;C timestamp of the running command; null = no marked command. */
  commandStartedAt: number | null;
}

export const initialCommandWatchState = (): CommandWatchState => ({
  lastActivityAt: 0,
  commandStartedAt: null,
});

export interface CommandWatchStep {
  state: CommandWatchState;
  /** True exactly when this event completes a long-enough command. */
  notify: boolean;
}

/** Pure transition — timestamps and threshold are arguments so tests never
 *  touch timers or settings storage. */
export const reduceCommandWatch = (
  state: CommandWatchState,
  event: CommandWatchEvent,
  thresholdMs: number,
): CommandWatchStep => {
  switch (event.type) {
    case 'input':
      return { state: { ...state, lastActivityAt: event.at }, notify: false };
    case 'output': {
      // The heuristic needs a baseline; a session's very first output (the
      // shell banner) must not look like "silence, then a prompt".
      const notify =
        state.commandStartedAt === null &&
        state.lastActivityAt > 0 &&
        event.at - state.lastActivityAt >= thresholdMs;
      return {
        state: { lastActivityAt: event.at, commandStartedAt: state.commandStartedAt },
        notify,
      };
    }
    case 'command-start':
      return {
        state: { lastActivityAt: event.at, commandStartedAt: event.at },
        notify: false,
      };
    case 'command-finish': {
      // D without a C (e.g. a foreign integration's stray mark) decides
      // nothing — there is no start to measure from.
      const startedAt = state.commandStartedAt;
      const notify = startedAt !== null && event.at - startedAt >= thresholdMs;
      return { state: { lastActivityAt: event.at, commandStartedAt: null }, notify };
    }
  }
};

// ── Per-session wiring ───────────────────────────────────────────────────────

interface CommandWatchEntry {
  state: CommandWatchState;
  /** Fires the tab badge; the panel decides visibility (active tabs skip). */
  onNotify: () => void;
}

/** Module-level by design — matching the shell-integration session store, it
 *  spans panel remounts and tabs attached from the CLI-agent bus. */
const watches = new Map<string, CommandWatchEntry>();

const now = () => Date.now();

export const setCommandWatchTarget = (sessionId: string, onNotify: () => void): void => {
  watches.set(sessionId, { state: watches.get(sessionId)?.state ?? initialCommandWatchState(), onNotify });
};

export const forgetCommandWatch = (sessionId: string): void => {
  watches.delete(sessionId);
};

const step = (sessionId: string, event: CommandWatchEvent): void => {
  const entry = watches.get(sessionId);
  if (!entry) return;
  const thresholdMs = readTerminalCommandNotifySeconds() * 1000;
  const result = reduceCommandWatch(entry.state, event, thresholdMs);
  entry.state = result.state;
  if (result.notify) entry.onNotify();
};

/** Keystroke/paste into the session — resets the heuristic baseline. */
export const notifyCommandInput = (sessionId: string): void => {
  step(sessionId, { type: 'input', at: now() });
};

/** PTY output chunk — heuristic completion candidate. */
export const notifyCommandOutput = (sessionId: string): void => {
  step(sessionId, { type: 'output', at: now() });
};

/** OSC 133;C — the shell started executing a command. */
export const notifyCommandStart = (sessionId: string): void => {
  step(sessionId, { type: 'command-start', at: now() });
};

/** OSC 133;D — the shell returned to its prompt. */
export const notifyCommandFinish = (sessionId: string): void => {
  step(sessionId, { type: 'command-finish', at: now() });
};

/** Test isolation: wipe every tracked session. */
export const resetCommandWatchStore = (): void => {
  watches.clear();
};
