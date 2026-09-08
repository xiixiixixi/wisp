import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import React from 'react';

interface ChatInputProps {
  chatInput: string;
  setChatInput: (input: string) => void;
  isAiLoading: boolean;
  isAgentRunning: boolean;
  agentEnabled: boolean;
  onSendMessage: () => void;
  onCancel: () => void;
}

/**
 * Rough token estimate: ~4 characters per token for English text.
 * This is an approximation — actual tokenisation depends on the model.
 */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

const ChatInput = ({
  chatInput,
  setChatInput,
  isAiLoading,
  isAgentRunning,
  agentEnabled,
  onSendMessage,
  onCancel,
}: ChatInputProps) => {
  const { t: tUi } = useTranslation();
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
  };

  const charCount = chatInput.length;
  const tokenEstimate = estimateTokens(chatInput);

  return (
    <div className="flex-shrink-0 border-t border-xp-border px-3 py-2.5">
      <div className="flex gap-2">
        <textarea
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder={
            agentEnabled ? i18n.t('chat.agentPlaceholder') : i18n.t('chat.askPlaceholder')
          }
          className="flex-1 resize-none rounded-[2px] border border-xp-border bg-xp-bg px-3 py-2 text-sm outline-none"
          disabled={isAiLoading || isAgentRunning}
          rows={1}
          aria-label={
            agentEnabled
              ? tUi('interface.askTheAgentToManageYourFiles')
              : tUi('interface.askAboutYourFiles')
          }
        />
        {isAgentRunning ? (
          <button
            onClick={onCancel}
            className="flex items-center justify-center rounded-[2px] bg-xp-red px-4 py-2 text-xs font-medium text-xp-on-accent transition-colors hover:opacity-80"
            aria-label={tUi('chat.stopAgent')}
          >
            {tUi('agentManager.workspace.stop')}
          </button>
        ) : (
          <button
            onClick={onSendMessage}
            disabled={!chatInput.trim() || isAiLoading}
            className="flex items-center justify-center rounded-[2px] bg-xp-blue px-4 py-2 text-xp-on-accent transition-colors hover:bg-opacity-80 disabled:opacity-50"
            aria-label={tUi('aiChat.input.sendMessage')}
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          </button>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-xp-text-muted">
        <span>
          {tUi('interface.enterToSend')}
          {agentEnabled ? tUi('interface.agentMode') : ''}
        </span>
        {charCount > 0 && (
          <span>{tUi('messages.inputSize', { chars: charCount, tokens: tokenEstimate })}</span>
        )}
      </div>
    </div>
  );
};

export default ChatInput;
