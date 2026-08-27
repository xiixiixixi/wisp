/**
 * Mini event bus connecting the CLI agent launcher (NewAgentForm) with the
 * terminal panel. The launcher spawns its own PTY session (not via
 * XTermPanel), so the terminal panel needs to be told to attach a tab to it.
 *
 * The pending list covers the lazy-loading race: XTermPanel is React.lazy,
 * so the 'wisp:cli-agent-launched' CustomEvent can fire before its listener
 * exists. Launchers push into `pending` before dispatching; the panel drains
 * `pending` on mount.
 */

export interface CliAgentLaunch {
  sessionId: string;
  label: string;
  workingDirectory: string;
  agentType: string;
}

export const CLI_AGENT_LAUNCHED_EVENT = 'wisp:cli-agent-launched';

const pendingLaunches: CliAgentLaunch[] = [];

export const emitCliAgentLaunched = (launch: CliAgentLaunch): void => {
  pendingLaunches.push(launch);
  window.dispatchEvent(new CustomEvent(CLI_AGENT_LAUNCHED_EVENT, { detail: launch }));
};

/** Return and clear launches that happened before the caller mounted. */
export const consumePendingCliLaunches = (): CliAgentLaunch[] => {
  const drained = pendingLaunches.slice();
  pendingLaunches.length = 0;
  return drained;
};
