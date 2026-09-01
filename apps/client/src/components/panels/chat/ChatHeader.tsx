// AIModel and FileContext types removed — no longer used directly
import i18n from '@/i18n';
import type { ChatState } from '@/hooks/use-chat-state';
import { AgentService } from '@/lib/agent-service';
import { FolderOpen, FolderClosed, FileText } from 'lucide-react';

interface ChatHeaderProps {
  state: ChatState;
  currentPath: string;
  onNewSession?: () => void;
  onToggleHistory: () => void;
  showHistory: boolean;
  sessionsCount: number;
  // State setters
  setIsSettingsMinimized: (minimized: boolean) => void;
  setIsModelDropdownOpen: (open: boolean) => void;
  setSelectedModel: (model: string) => void;
  setAgentEnabled: (enabled: boolean) => void;
  setAutoApprove: (autoApprove: boolean) => void;
  setThinkingEnabled: (enabled: boolean) => void;
  setIsContextDropdownOpen: (open: boolean) => void;
  setContextSearchQuery: (query: string) => void;
  setIncludeCurrentFolder: (include: boolean) => void;
  removeContextFile: (path: string) => void;
  resetContext: () => void;
  addContextFileFromList: (file: {
    name: string;
    path: string;
    file_type: string;
    is_dir: boolean;
  }) => void;
  filteredContextFiles: Array<{ name: string; path: string; file_type: string; is_dir: boolean }>;
}

const ChatHeader = ({
  state,
  currentPath,
  onNewSession,
  onToggleHistory,
  showHistory,
  sessionsCount,
  setIsSettingsMinimized,
  setIsModelDropdownOpen: _setIsModelDropdownOpen,
  setSelectedModel: _setSelectedModel,
  setAgentEnabled,
  setAutoApprove,
  setThinkingEnabled,
  setIsContextDropdownOpen,
  setContextSearchQuery,
  setIncludeCurrentFolder,
  removeContextFile,
  resetContext,
  addContextFileFromList,
  filteredContextFiles,
}: ChatHeaderProps) => {
  return (
    <div className="flex-shrink-0 border-b border-xp-border px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-medium">
          {state.agentEnabled ? i18n.t('chat.wispAgent') : i18n.t('chat.copilotAssistant')}
        </h3>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {onNewSession && (
            <button
              onClick={() => {
                onNewSession();
              }}
              className="rounded-[2px] p-1 text-xs transition-colors hover:bg-xp-surface-light"
              title="New chat"
              aria-label="Start new chat session"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          )}
          {sessionsCount > 0 && (
            <button
              onClick={onToggleHistory}
              className={`rounded-[2px] p-1 text-xs transition-colors ${showHistory ? 'bg-xp-blue text-xp-on-accent' : 'hover:bg-xp-surface-light'}`}
              title={i18n.t('chat.chatHistory')}
              aria-label="Toggle chat history"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </button>
          )}
          <button
            onClick={() => setIsSettingsMinimized(!state.isSettingsMinimized)}
            className="rounded-[2px] p-1 text-xs transition-colors hover:bg-xp-surface-light"
            title={
              state.isSettingsMinimized
                ? i18n.t('chat.expandSettings')
                : i18n.t('chat.minimizeSettings')
            }
            aria-label={
              state.isSettingsMinimized
                ? i18n.t('chat.expandChatSettings')
                : i18n.t('chat.minimizeChatSettings')
            }
            aria-expanded={!state.isSettingsMinimized}
          >
            {state.isSettingsMinimized ? '\u2699\uFE0F' : '\u25BC'}
          </button>
          {(() => {
            let dotClass = 'bg-xp-red';
            if (state.agentEnabled) dotClass = 'bg-xp-purple';
            else if (state.ollamaStatus) dotClass = 'bg-xp-green';
            return <div className={`h-2 w-2 flex-shrink-0 rounded-full ${dotClass}`} />;
          })()}
          <span className="whitespace-nowrap text-xs text-xp-text-muted">
            {(() => {
              if (state.agentEnabled) return i18n.t('chat.agentMode');
              if (state.ollamaStatus) return 'AI Connected';
              return i18n.t('chat.limitedAi');
            })()}
          </span>
        </div>
      </div>

      {/* Expanded Settings */}
      {!state.isSettingsMinimized && (
        <div className="space-y-3">
          {/* Model Display (configured in Settings > AI) */}
          <div className="flex items-center justify-between rounded-[2px] border border-xp-border bg-xp-bg px-3 py-2 text-xs">
            <span className="text-xp-text-muted">Model:</span>
            <span className="truncate">{state.selectedModel}</span>
          </div>
          <p className="text-[10px] text-xp-text-muted">Change model in Settings &gt; AI</p>

          {/* Agent Mode Toggle */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-xp-text-muted">Agent Mode:</span>
            <button
              onClick={() => setAgentEnabled(!state.agentEnabled)}
              className={`rounded-[2px] px-3 py-1 text-xs transition-colors ${
                state.agentEnabled
                  ? 'bg-xp-purple text-xp-on-accent hover:opacity-80'
                  : 'bg-xp-border text-xp-text hover:bg-xp-surface-light'
              }`}
              aria-label={`Agent mode: ${state.agentEnabled ? 'enabled' : 'disabled'}`}
              aria-pressed={state.agentEnabled}
            >
              {state.agentEnabled ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Auto-Approve Toggle */}
          {state.agentEnabled && (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-xs text-xp-text-muted">Auto-Approve</span>
                <p className="truncate text-[10px] text-xp-text-muted">
                  {state.autoApprove
                    ? i18n.t('chat.allActionsAuto')
                    : i18n.t('chat.asksBeforeWrites')}
                </p>
              </div>
              <button
                onClick={() => {
                  const next = !state.autoApprove;
                  setAutoApprove(next);
                  AgentService.getSettings()
                    .then((s) => {
                      AgentService.updateSettings({ ...s, auto_approve: next });
                    })
                    .catch((err) => {
                      console.warn('Failed to persist auto-approve setting:', err);
                    });
                }}
                className={`rounded-[2px] px-3 py-1 text-xs transition-colors ${
                  state.autoApprove
                    ? 'bg-xp-orange text-xp-on-accent hover:opacity-80'
                    : 'bg-xp-border text-xp-text hover:bg-xp-surface-light'
                }`}
                aria-label={`Auto-approve: ${state.autoApprove ? 'enabled' : 'disabled'}`}
                aria-pressed={state.autoApprove}
              >
                {state.autoApprove ? 'ON' : 'OFF'}
              </button>
            </div>
          )}

          {/* Thinking Mode Toggle */}
          {state.agentEnabled && (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-xs text-xp-text-muted">Thinking</span>
                <p className="truncate text-[10px] text-xp-text-muted">
                  {state.thinkingEnabled
                    ? i18n.t('chat.extendedReasoning')
                    : i18n.t('chat.standardResponses')}
                </p>
              </div>
              <button
                onClick={() => {
                  const next = !state.thinkingEnabled;
                  setThinkingEnabled(next);
                  AgentService.getSettings()
                    .then((s) => {
                      AgentService.updateSettings({ ...s, thinking_enabled: next });
                    })
                    .catch((err) => {
                      console.warn('Failed to persist thinking setting:', err);
                    });
                }}
                className={`rounded-[2px] px-3 py-1 text-xs transition-colors ${
                  state.thinkingEnabled
                    ? 'bg-xp-cyan text-xp-on-accent hover:opacity-80'
                    : 'bg-xp-border text-xp-text hover:bg-xp-surface-light'
                }`}
                aria-label={`Thinking mode: ${state.thinkingEnabled ? 'enabled' : 'disabled'}`}
                aria-pressed={state.thinkingEnabled}
              >
                {state.thinkingEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Compact mode info */}
      {state.isSettingsMinimized && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate text-xp-text-muted">
            Model: {state.selectedModel.replace('claude-', '').substring(0, 14)}
          </span>
          {state.agentEnabled && (
            <div className="flex flex-shrink-0 items-center gap-1">
              <span className="rounded-[2px] bg-xp-purple px-1.5 py-0.5 text-[11px] text-xp-on-accent">
                Agent
              </span>
              {state.autoApprove && (
                <span className="rounded-[2px] bg-xp-orange px-1.5 py-0.5 text-[11px] text-xp-on-accent">
                  Auto
                </span>
              )}
              {state.thinkingEnabled && (
                <span className="rounded-[2px] bg-xp-cyan px-1.5 py-0.5 text-[11px] text-xp-on-accent">
                  Think
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Context */}
      <div className="mt-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-xp-text-muted">
            Context
            {(() => {
              if (state.contextFiles.length > 0) {
                return ` (${state.contextFiles.length + (state.includeCurrentFolder ? 1 : 0)})`;
              }
              if (state.includeCurrentFolder) return ' (1)';
              return '';
            })()}
            :
          </span>
          {(state.contextFiles.length > 0 || !state.includeCurrentFolder) && (
            <button
              onClick={resetContext}
              className="text-xs text-xp-text-muted transition-colors hover:text-xp-text"
            >
              Reset
            </button>
          )}
        </div>
        <div className="max-h-24 space-y-1 overflow-y-auto">
          {/* Current folder -- always shown, removable */}
          {state.includeCurrentFolder ? (
            <div className="flex items-center justify-between rounded-[2px] border border-xp-blue border-opacity-20 bg-xp-blue bg-opacity-10 p-1.5 text-xs">
              <span className="flex flex-1 items-center gap-1.5 truncate">
                <FolderOpen size={14} className="flex-shrink-0 text-xp-blue" />
                <span className="truncate text-xp-text">
                  {currentPath.split(/[/\\]/).pop() || currentPath}
                </span>
                <span className="shrink-0 text-[10px] text-xp-text-muted">current folder</span>
              </span>
              <button
                onClick={() => setIncludeCurrentFolder(false)}
                className="ml-1.5 shrink-0 text-xp-text-muted transition-colors hover:text-xp-text"
                title="Remove current folder from context"
              >
                {'\u00D7'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIncludeCurrentFolder(true)}
              className="flex w-full items-center gap-1.5 rounded-[2px] p-1.5 text-xs text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
            >
              <span>+</span>
              <span>Re-add current folder</span>
            </button>
          )}
          {/* Additional context files */}
          {state.contextFiles.map((file) => (
            <div
              key={file.path}
              className="flex items-center justify-between rounded-[2px] bg-xp-bg p-1.5 text-xs"
            >
              <span className="flex-1 truncate">{file.name}</span>
              <button
                onClick={() => removeContextFile(file.path)}
                className="ml-1.5 text-xp-text-muted transition-colors hover:text-xp-text"
              >
                {'\u00D7'}
              </button>
            </div>
          ))}
        </div>
        {/* Add more context files */}
        <div className="relative mt-1.5">
          <button
            onClick={() => setIsContextDropdownOpen(!state.isContextDropdownOpen)}
            className="flex w-full items-center gap-2 rounded-[2px] border border-xp-border bg-xp-bg px-3 py-1.5 text-xs transition-colors hover:bg-xp-surface-light"
            aria-label="Add context files"
            aria-expanded={state.isContextDropdownOpen}
          >
            <span>+ Add context files</span>
          </button>
          {state.isContextDropdownOpen && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 rounded-[2px] border border-xp-border bg-xp-popover">
              <div className="border-b border-xp-border p-2">
                <input
                  type="text"
                  placeholder={i18n.t('chat.searchFilesPlaceholder')}
                  value={state.contextSearchQuery}
                  onChange={(e) => setContextSearchQuery(e.target.value)}
                  className="w-full rounded-[2px] border border-xp-border bg-xp-bg px-2 py-1 text-xs"
                  aria-label="Search context files"
                />
              </div>
              <div className="max-h-48 overflow-y-auto">
                {filteredContextFiles.length > 0 ? (
                  filteredContextFiles.map((file) => (
                    <button
                      key={file.path}
                      onClick={() => addContextFileFromList(file)}
                      className="flex w-full items-center px-3 py-2 text-left text-xs transition-colors hover:bg-xp-surface-light"
                      disabled={state.contextFiles.some((f) => f.path === file.path)}
                    >
                      <span className="mr-2 inline-flex">
                        {file.is_dir ? <FolderClosed size={14} /> : <FileText size={14} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{file.name}</div>
                      </div>
                      {state.contextFiles.some((f) => f.path === file.path) && (
                        <span className="ml-1 text-xp-green">{'\u2713'}</span>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-xs text-xp-text-muted">No files available</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatHeader;
