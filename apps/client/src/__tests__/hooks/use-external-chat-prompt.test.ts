import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queueExternalChatPrompt, useExternalChatPrompt } from '@/hooks/use-external-chat-prompt';

const clearPendingPrompt = () => {
  delete (window as Window & { __wisp_pending_ai_prompt__?: string }).__wisp_pending_ai_prompt__;
};

describe('useExternalChatPrompt', () => {
  afterEach(clearPendingPrompt);

  it('delivers prompts to a chat panel that is already mounted', () => {
    const onPrompt = vi.fn();
    renderHook(() => useExternalChatPrompt(onPrompt));

    act(() => queueExternalChatPrompt('  Summarize this folder  '));

    expect(onPrompt).toHaveBeenCalledWith('Summarize this folder');
    expect(
      (window as Window & { __wisp_pending_ai_prompt__?: string }).__wisp_pending_ai_prompt__,
    ).toBeUndefined();
  });

  it('consumes a prompt queued before the lazy chat panel mounts', async () => {
    const onPrompt = vi.fn();
    act(() => queueExternalChatPrompt('Compare these files'));

    renderHook(() => useExternalChatPrompt(onPrompt));

    await waitFor(() => expect(onPrompt).toHaveBeenCalledWith('Compare these files'));
    expect(onPrompt).toHaveBeenCalledOnce();
  });
});
