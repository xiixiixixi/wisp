import { useCallback, useEffect, useRef, useMemo } from 'react';
import { useChatFile } from '@/hooks/use-chat-file';
import {
  MessageBubble,
  ToolCallsList,
  ActivePlanDisplay,
  PendingApprovalCard,
  StreamingMessage,
  EmptyState,
} from '@/components/panels/ChatMessage';
import ChatInput from '@/components/panels/ChatInput';

// ── Props ─────────────────────────────────────────────────────────────────────

interface ChatFileViewProps {
  filePath: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Derive a human-readable title from a .chat file path. */
const deriveTitleFromPath = (filePath: string): string => {
  // Extract filename from path (handle both / and \)
  const segments = filePath.split(/[/\\]/);
  let name = segments[segments.length - 1] || 'Chat';

  // Remove .chat extension
  if (name.toLowerCase().endsWith('.chat')) {
    name = name.slice(0, -5);
  }

  // Remove date prefix if it starts with YYYY-MM-DD_
  name = name.replace(/^\d{4}-\d{2}-\d{2}_/, '');

  // Replace hyphens and underscores with spaces
  name = name.replace(/[-_]/g, ' ');

  // Capitalize first letter of each word
  name = name.replace(/\b\w/g, (c) => c.toUpperCase());

  return name || 'Chat';
};

// ── Component ─────────────────────────────────────────────────────────────────

const ChatFileView = ({ filePath }: ChatFileViewProps) => {
  const {
    messages,
    isLoading,
    chatInput,
    setChatInput,
    sendMessage,
    handleCancel,
    handleApproval,
    model,
    setModel: _setModel,
    availableModels: _availableModels,
    thinkingEnabled,
    setThinkingEnabled,
    contextFiles,
    removeContextFile,
    isAgentRunning,
    toolCalls,
    pendingApprovals,
    streamingText,
    streamingThinking,
    activePlan,
    toggleToolCallExpand,
  } = useChatFile({ filePath });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const title = useMemo(() => deriveTitleFromPath(filePath), [filePath]);

  /**
   * Dispatch a CustomEvent to replace the currently selected code in the editor.
   * The code-editor extension listens for this event.
   */
  const handleApplyCode = useCallback((code: string) => {
    window.dispatchEvent(new CustomEvent('wisp-apply-to-editor', { detail: { code } }));
  }, []);

  /**
   * Only show "Apply to editor" when there is an active editor selection.
   * This is checked at render time so the button disappears once the selection is cleared.
   */
  const hasEditorSelection = Boolean(
    (window as unknown as { __wisp_state__?: { editorSelection?: unknown } }).__wisp_state__
      ?.editorSelection,
  );

  const onApplyCode = hasEditorSelection ? handleApplyCode : undefined;

  // Auto-scroll to bottom on new messages / streaming
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, toolCalls, streamingText]);

  // ── Loading state ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-xp-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-xp-blue border-t-transparent" />
          <span className="text-sm text-xp-text-muted">Loading chat...</span>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col bg-xp-bg" role="region" aria-label="Chat file view">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-xp-border bg-xp-surface px-4 py-3">
        <div className="mx-auto max-w-3xl">
          {/* Top row: title + model + thinking */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Title */}
            <h2 className="mr-auto truncate text-base font-medium text-xp-text">{title}</h2>

            {/* Model display (configured in Settings > AI) */}
            <span className="rounded border border-xp-border bg-xp-bg px-3 py-1.5 text-xs text-xp-text-muted">
              {model}
            </span>

            {/* Thinking toggle */}
            <button
              onClick={() => setThinkingEnabled(!thinkingEnabled)}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                thinkingEnabled
                  ? 'bg-xp-cyan text-[var(--xp-bg)] hover:opacity-80'
                  : 'bg-xp-border text-xp-text hover:bg-xp-surface-light'
              }`}
              aria-label={`Thinking mode: ${thinkingEnabled ? 'enabled' : 'disabled'}`}
              aria-pressed={thinkingEnabled}
            >
              {thinkingEnabled ? 'Thinking ON' : 'Thinking OFF'}
            </button>
          </div>

          {/* Context chips */}
          {contextFiles.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-xp-text-muted">Context:</span>
              {contextFiles.map((file) => (
                <span
                  key={file.path}
                  className="inline-flex items-center gap-1 rounded border border-xp-blue/20 bg-xp-blue/10 px-2 py-0.5 text-xs text-xp-text"
                >
                  <span className="max-w-[150px] truncate">{file.name}</span>
                  <button
                    onClick={() => removeContextFile(file.path)}
                    className="flex-shrink-0 text-xp-text-muted transition-colors hover:text-xp-text"
                    aria-label={`Remove ${file.name} from context`}
                  >
                    {'\u00D7'}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Messages area ──────────────────────────────────────────────────── */}
      <div
        ref={messagesContainerRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6"
        aria-live="polite"
        aria-label="Chat messages"
        role="log"
      >
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.length === 0 && !isAgentRunning ? (
            <EmptyState agentEnabled={true} />
          ) : (
            messages.map((message, idx) => (
              <MessageBubble
                key={`${message.role}-${message.timestamp || idx}`}
                message={message}
                onApplyCode={message.role === 'assistant' ? onApplyCode : undefined}
              />
            ))
          )}

          {/* Tool Calls Display */}
          <ToolCallsList toolCalls={toolCalls} onToggleExpand={toggleToolCallExpand} />

          {/* Active Plan Display */}
          {activePlan && <ActivePlanDisplay plan={activePlan} />}

          {/* Pending Approval Dialogs */}
          {pendingApprovals.map((tc) => (
            <PendingApprovalCard
              key={tc.id}
              toolCall={tc}
              activePlan={activePlan}
              onApproval={handleApproval}
            />
          ))}

          {/* Streaming Thinking (collapsible) */}
          {streamingThinking && (
            <div className="flex justify-start">
              <details
                open
                className="min-w-0 max-w-[85%] overflow-hidden rounded-lg border border-xp-border bg-xp-bg"
              >
                <summary className="hover:bg-xp-bg-hover flex cursor-pointer select-none items-center gap-1.5 px-3 py-1.5 text-xs text-xp-text-muted">
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-xp-cyan" />
                  <span>Thinking...</span>
                </summary>
                <div className="max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-xp-border px-3 py-2 text-xs text-xp-text-muted">
                  {streamingThinking}
                </div>
              </details>
            </div>
          )}

          {/* Streaming Text */}
          <StreamingMessage text={streamingText} />

          {/* Scroll anchor */}
          <div ref={messagesEndRef} />

          {/* Screen reader status announcements */}
          <div className="sr-only" aria-live="assertive">
            {isAgentRunning && 'Agent is processing your request'}
          </div>
        </div>
      </div>

      {/* ── Input area ─────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-xp-border bg-xp-surface">
        <div className="mx-auto max-w-3xl">
          <ChatInput
            chatInput={chatInput}
            setChatInput={setChatInput}
            isAiLoading={false}
            isAgentRunning={isAgentRunning}
            agentEnabled={true}
            onSendMessage={sendMessage}
            onCancel={handleCancel}
          />
        </div>
      </div>
    </div>
  );
};

export default ChatFileView;
