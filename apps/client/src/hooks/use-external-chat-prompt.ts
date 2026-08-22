import { useEffect, useRef } from 'react';

const CHAT_PROMPT_EVENT = 'wisp-chat-inject-prompt';
const PENDING_PROMPT_KEY = '__wisp_pending_ai_prompt__';

type ChatPromptWindow = Window & { __wisp_pending_ai_prompt__?: string };

const getChatPromptWindow = () => window as ChatPromptWindow;

/**
 * Queue a prompt for the standalone chat panel. The stored fallback covers
 * lazy-mounted panels; the event handles panels that are already open.
 */
export const queueExternalChatPrompt = (prompt: string) => {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) return;

  const chatWindow = getChatPromptWindow();
  chatWindow[PENDING_PROMPT_KEY] = normalizedPrompt;
  chatWindow.dispatchEvent(
    new CustomEvent(CHAT_PROMPT_EVENT, { detail: { prompt: normalizedPrompt } }),
  );
};

export const useExternalChatPrompt = (onPrompt: (prompt: string) => void) => {
  const onPromptRef = useRef(onPrompt);
  onPromptRef.current = onPrompt;

  useEffect(() => {
    const chatWindow = getChatPromptWindow();
    let cancelled = false;

    const consumePrompt = (prompt: string) => {
      const normalizedPrompt = prompt.trim();
      if (!normalizedPrompt || cancelled) return;
      if (chatWindow[PENDING_PROMPT_KEY] === normalizedPrompt) {
        delete chatWindow[PENDING_PROMPT_KEY];
      }
      onPromptRef.current(normalizedPrompt);
    };

    const handlePrompt = (event: Event) => {
      const prompt = (event as CustomEvent<{ prompt?: string }>).detail?.prompt;
      if (prompt) consumePrompt(prompt);
    };

    chatWindow.addEventListener(CHAT_PROMPT_EVENT, handlePrompt);

    const pendingPrompt = chatWindow[PENDING_PROMPT_KEY];
    if (pendingPrompt) {
      delete chatWindow[PENDING_PROMPT_KEY];
      queueMicrotask(() => consumePrompt(pendingPrompt));
    }

    return () => {
      cancelled = true;
      chatWindow.removeEventListener(CHAT_PROMPT_EVENT, handlePrompt);
    };
  }, []);
};
