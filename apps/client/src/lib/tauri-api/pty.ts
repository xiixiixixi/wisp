import { transport, listenToEvent } from '../transport';

export const ptySpawn = async (
  sessionId: string,
  cwd: string,
  cols: number,
  rows: number,
  /** Custom shell program; omitted = resolve $SHELL, then the platform
   *  default (Rust side, see `resolve_shell` in pty.rs). */
  shell?: string,
  /** Extra environment entries applied to the spawned shell (#45). */
  env?: { key: string; value: string }[],
): Promise<void> =>
  await transport('pty_spawn', { sessionId, cwd, cols, rows, shell, env });

export const ptyWrite = async (sessionId: string, data: string): Promise<void> =>
  await transport('pty_write', { sessionId, data });

export const ptyResize = async (sessionId: string, cols: number, rows: number): Promise<void> =>
  await transport('pty_resize', { sessionId, cols, rows });

export const ptyKill = async (sessionId: string): Promise<void> =>
  await transport('pty_kill', { sessionId });

export const ptyKillAll = async (): Promise<void> => await transport('pty_kill_all');

/** Login shell from $SHELL as the spawn fallback would resolve it; null on
 *  platforms without one (#45, shown by the terminal settings page). */
export const ptyLoginShell = async (): Promise<string | null> =>
  await transport('pty_login_shell');

export interface PtyOutputPayload {
  session_id: string;
  data: string;
}

export const listenToPtyOutput = async (
  callback: (payload: PtyOutputPayload) => void,
): Promise<() => void> => listenToEvent<PtyOutputPayload>('pty-output', callback);

export const listenToPtyExit = async (callback: (sessionId: string) => void): Promise<() => void> =>
  listenToEvent<string>('pty-exit', callback);
