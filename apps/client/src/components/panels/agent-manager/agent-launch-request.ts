export const AGENT_LAUNCH_REQUEST_EVENT = 'wisp:agent-launch-request';

let pendingPrompt: string | null = null;

export const requestAgentLaunch = (prompt?: string): void => {
  pendingPrompt = prompt?.trim() || null;
  window.dispatchEvent(
    new CustomEvent(AGENT_LAUNCH_REQUEST_EVENT, {
      detail: { prompt: pendingPrompt },
    }),
  );
};

export const consumePendingAgentPrompt = (): string | null => {
  const prompt = pendingPrompt;
  pendingPrompt = null;
  return prompt;
};
