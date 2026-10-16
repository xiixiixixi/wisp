export type ExternalAgentType =
  | 'claude-code'
  | 'codex'
  | 'gemini'
  | 'opencode'
  | 'aider'
  | 'unknown';

export type ExternalAgentStatus = 'active' | 'idle' | 'exited';

export interface ExternalAgent {
  id: string;
  type: ExternalAgentType;
  displayName: string;
  terminalSessionId: string;
  terminalLabel: string;
  workingDirectory: string;
  status: ExternalAgentStatus;
  detectedAt: number;
  lastActivityAt: number;
  filesChanged: string[];
}

type RegistryAction = 'detected' | 'updated' | 'exited';

const agents = new Map<string, ExternalAgent>();
const listeners = new Set<() => void>();
let snapshot: ExternalAgent[] = [];

const publish = (agent: ExternalAgent, action: RegistryAction) => {
  snapshot = Array.from(agents.values()).sort((a, b) => b.detectedAt - a.detectedAt);
  listeners.forEach((listener) => listener());
  window.dispatchEvent(
    new CustomEvent('wisp-external-agent', {
      detail: { agent, action },
    }),
  );
};

export const subscribeToExternalAgents = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getExternalAgentsSnapshot = (): ExternalAgent[] => snapshot;

export const getExternalAgent = (sessionId: string): ExternalAgent | undefined =>
  agents.get(sessionId);

export const upsertExternalAgent = (agent: ExternalAgent): void => {
  const action: RegistryAction = agents.has(agent.terminalSessionId) ? 'updated' : 'detected';
  agents.set(agent.terminalSessionId, agent);
  publish(agent, action);
};

export const updateExternalAgent = (
  sessionId: string,
  update: Partial<Omit<ExternalAgent, 'terminalSessionId'>>,
): void => {
  const existing = agents.get(sessionId);
  if (!existing) return;
  const next = { ...existing, ...update };
  agents.set(sessionId, next);
  publish(next, next.status === 'exited' ? 'exited' : 'updated');
};

export const markExternalAgentExited = (sessionId: string): void => {
  updateExternalAgent(sessionId, { status: 'exited', lastActivityAt: Date.now() });
};

export const dismissExternalAgent = (sessionId: string): void => {
  const existing = agents.get(sessionId);
  if (!existing) return;
  agents.delete(sessionId);
  publish({ ...existing, status: 'exited' }, 'exited');
};

export const clearExternalAgents = (): void => {
  agents.clear();
  snapshot = [];
  listeners.forEach((listener) => listener());
};
