/**
 * Inline form for creating a new multi-session agent.
 * Collects agent type, name, prompt, model selection, and scope configuration.
 * Supports Wisp Cloud agents and launching external CLI agents
 * (Claude Code, Codex, or a custom command).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CreateSessionParams,
  AgentScopeConfig as ScopeConfigType,
} from '@/lib/tauri-api-types';
import { getWispState } from '@/components/panels/chat-context-helpers';
import {
  detectWorkspaceContext,
  buildWorkspacePrompt,
} from '@/components/panels/chat-workspace-awareness';
import AgentScopeConfig, { DEFAULT_SCOPE } from './AgentScopeConfig';
import {
  launchClaudeCode,
  launchCodex,
  launchGeminiCli,
  launchOpenCode,
  launchCustomCli,
} from './launch-cli-agent';
import { TauriAPI } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';
import { STORAGE_KEYS } from '@/lib/storage-keys';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export type AgentType =
  | 'cloud'
  | 'claude-code'
  | 'gemini-cli'
  | 'opencode'
  | 'codex'
  | 'custom-cli';

/** Known external CLI agents: binary to detect + install hint when missing. */
const CLI_AGENTS: Array<{
  type: AgentType;
  command: string;
  installCmd: string;
  labelKey: string;
}> = [
  {
    type: 'claude-code',
    command: 'claude',
    installCmd: 'npm install -g @anthropic-ai/claude-code',
    labelKey: 'agentManager.newAgent.typeClaudeCode',
  },
  {
    type: 'gemini-cli',
    command: 'gemini',
    installCmd: 'npm install -g @google/gemini-cli',
    labelKey: 'agentManager.newAgent.typeGeminiCli',
  },
  {
    type: 'opencode',
    command: 'opencode',
    installCmd: 'curl -fsSL https://opencode.ai/install | bash',
    labelKey: 'agentManager.newAgent.typeOpenCode',
  },
  {
    type: 'codex',
    command: 'codex',
    installCmd: 'npm install -g @openai/codex',
    labelKey: 'agentManager.newAgent.typeCodex',
  },
];

/** One-tap suggestions for the custom CLI input. */
const CUSTOM_SUGGESTIONS = ['zcode', 'gemini', 'aider', 'opencode', 'goose'];

const RECENT_COMMANDS_LIMIT = 5;

const loadRecentCommands = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.RECENT_CLI_COMMANDS) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((s) => typeof s === 'string').slice(0, RECENT_COMMANDS_LIMIT)
      : [];
  } catch {
    return [];
  }
};

const saveRecentCommand = (command: string): void => {
  const trimmed = command.trim();
  if (!trimmed) return;
  const next = [trimmed, ...loadRecentCommands().filter((c) => c !== trimmed)].slice(
    0,
    RECENT_COMMANDS_LIMIT,
  );
  try {
    localStorage.setItem(STORAGE_KEYS.RECENT_CLI_COMMANDS, JSON.stringify(next));
  } catch {
    /* storage unavailable — recents just won't persist */
  }
};

interface NewAgentFormProps {
  onSubmit: (params: CreateSessionParams) => void;
  onCancel: () => void;
  /** Called after a CLI agent is successfully spawned */
  onCliLaunched?: (sessionId: string, label: string) => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: '11px',
  background: 'var(--xp-bg)',
  border: '1px solid var(--xp-border)',
  borderRadius: '4px',
  color: 'var(--xp-text)',
  outline: 'none',
  boxSizing: 'border-box',
};

const NewAgentForm = ({ onSubmit, onCancel, onCliLaunched }: NewAgentFormProps) => {
  const { t } = useTranslation();
  const [agentType, setAgentType] = useState<AgentType>('cloud');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [customCommand, setCustomCommand] = useState('');
  const customCommandInputRef = useRef<HTMLInputElement>(null);
  const [model, setModel] = useState('claude-sonnet-4-20250514');
  const [workingDirectory, setWorkingDirectory] = useState('/');
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [projectContext, setProjectContext] = useState<string | undefined>(undefined);
  const [scope, setScope] = useState<ScopeConfigType>({ ...DEFAULT_SCOPE });
  const [showScope, setShowScope] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [copiedInstall, setCopiedInstall] = useState(false);
  /** Binary name -> installed; only populated on desktop after detection. */
  const [cliInstalled, setCliInstalled] = useState<Record<string, boolean>>({});
  const [recentCommands, setRecentCommands] = useState<string[]>([]);

  // Auto-detect context from Wisp state on mount
  useEffect(() => {
    setRecentCommands(loadRecentCommands());
    if (isTauri()) {
      TauriAPI.checkCliInstalled(CLI_AGENTS.map((a) => a.command))
        .then(setCliInstalled)
        .catch(() => {
          /* detection unavailable — badges simply not shown */
        });
    }
    const xState = getWispState();
    if (xState?.currentPath) {
      setWorkingDirectory(xState.currentPath);
    }
    if (xState?.selectedFiles && xState.selectedFiles.length > 0) {
      setSelectedFiles(xState.selectedFiles.map((f) => f.path));
    }

    // Detect workspace context asynchronously
    const dir = xState?.currentPath || '/';
    detectWorkspaceContext(dir)
      .then((ctx) => {
        const contextStr = buildWorkspacePrompt(ctx);
        if (contextStr) {
          setProjectContext(contextStr);
        }
      })
      .catch(() => {
        // Workspace detection failed — continue without project context
      });
  }, []);

  const handleScopeChange = useCallback((newScope: ScopeConfigType) => {
    setScope(newScope);
  }, []);

  const handleDirectoryChange = useCallback((dir: string) => {
    setWorkingDirectory(dir);
  }, []);

  const handleSubmit = async () => {
    if (isLaunching) return;
    setLaunchError(null);

    if (agentType === 'cloud') {
      if (!prompt.trim()) return;
      setIsLaunching(true);
      const sessionName = name.trim() || prompt.slice(0, 40);
      try {
        onSubmit({
          name: sessionName,
          prompt: prompt.trim(),
          model,
          working_directory: workingDirectory,
          selected_files: selectedFiles,
          project_context: projectContext,
          scope,
        });
        // Clear form after successful launch
        setName('');
        setPrompt('');
      } finally {
        setIsLaunching(false);
      }
      return;
    }

    // CLI-based agents
    setIsLaunching(true);
    try {
      let result;
      if (agentType === 'claude-code') {
        result = await launchClaudeCode(workingDirectory, prompt.trim() || undefined);
      } else if (agentType === 'gemini-cli') {
        result = await launchGeminiCli(workingDirectory, prompt.trim() || undefined);
      } else if (agentType === 'opencode') {
        // opencode's TUI takes no initial prompt argument; launch bare
        result = await launchOpenCode(workingDirectory);
      } else if (agentType === 'codex') {
        result = await launchCodex(workingDirectory, prompt.trim() || undefined);
      } else {
        // custom-cli
        const cmd = customCommand.trim();
        if (!cmd) {
          setIsLaunching(false);
          return;
        }
        result = await launchCustomCli(workingDirectory, cmd, prompt.trim() || undefined);
        saveRecentCommand(cmd);
        setRecentCommands(loadRecentCommands());
      }
      onCliLaunched?.(result.sessionId, result.label);
      // Clear form after successful launch
      setName('');
      setPrompt('');
      setCustomCommand('');
    } catch (err) {
      console.error('[NewAgentForm] Failed to launch CLI agent:', err);
      setLaunchError(
        `${t('agentManager.newAgent.launchFailed')}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsLaunching(false);
    }
  };

  /** Whether the submit button should be enabled */
  const canSubmit = (() => {
    if (isLaunching) return false;
    if (agentType === 'cloud') return !!prompt.trim();
    if (agentType === 'custom-cli') return !!customCommand.trim();
    // claude-code / codex can launch without a prompt
    return true;
  })();

  const isCliAgent = agentType !== 'cloud';

  const promptPlaceholder = (() => {
    if (agentType === 'custom-cli') return t('agentManager.newAgent.promptPlaceholderCustom');
    if (isCliAgent) return t('agentManager.newAgent.promptPlaceholderCli');
    return t('agentManager.newAgent.promptPlaceholder');
  })();

  /** The known CLI agent currently selected (null for cloud/custom). */
  const selectedCli = CLI_AGENTS.find((a) => a.type === agentType) ?? null;
  const cliMissing =
    !!selectedCli &&
    isTauri() &&
    selectedCli.command in cliInstalled &&
    !cliInstalled[selectedCli.command];

  const handleCopyInstall = () => {
    if (!selectedCli) return;
    navigator.clipboard.writeText(selectedCli.installCmd).catch(() => {});
    setCopiedInstall(true);
    setTimeout(() => setCopiedInstall(false), 2000);
  };

  const chipStyle: React.CSSProperties = {
    background: 'var(--xp-surface-light)',
    border: '1px solid var(--xp-border)',
    borderRadius: '4px',
    padding: '1px 8px',
    fontSize: '10px',
    color: 'var(--xp-text-muted)',
    cursor: 'pointer',
    fontFamily: 'monospace',
  };

  /** Fill the custom command input from a chip and make the change obvious:
   *  focus + select so the cursor jumps there and the text is highlighted. */
  const applyChipCommand = (command: string) => {
    setCustomCommand(command);
    setLaunchError(null);
    // Run after the state update renders the new value
    requestAnimationFrame(() => {
      const input = customCommandInputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    });
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '8px',
        border: '1px solid var(--xp-border)',
        borderRadius: '6px',
        background: 'var(--xp-surface)',
      }}
    >
      {/* Agent type selector */}
      <select
        value={agentType}
        onChange={(e) => {
          setAgentType(e.target.value as AgentType);
          setLaunchError(null);
        }}
        style={{ ...inputStyle, cursor: 'pointer' }}
      >
        <option value="cloud">{t('agentManager.newAgent.typeCloud')}</option>
        {CLI_AGENTS.map((a) => {
          // Badge the option once detection has run (desktop only)
          let suffix = '';
          if (a.command in cliInstalled) {
            suffix = cliInstalled[a.command] ? ' ●' : t('agentManager.newAgent.notDetected');
          }
          return (
            <option key={a.type} value={a.type}>
              {`${t(a.labelKey)}${suffix}`}
            </option>
          );
        })}
        <option value="custom-cli">{t('agentManager.newAgent.typeCustomCli')}</option>
      </select>

      {/* Name — only for cloud agents */}
      {!isCliAgent && (
        <input
          type="text"
          placeholder={t('agentManager.newAgent.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={inputStyle}
        />
      )}

      {/* Custom CLI command input with one-tap suggestions */}
      {agentType === 'custom-cli' && (
        <>
          {(recentCommands.length > 0 || CUSTOM_SUGGESTIONS.length > 0) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {recentCommands.map((cmd) => (
                <button
                  key={`recent-${cmd}`}
                  type="button"
                  onClick={() => applyChipCommand(cmd)}
                  style={chipStyle}
                  title={cmd}
                >
                  ↺ {cmd}
                </button>
              ))}
              {CUSTOM_SUGGESTIONS.filter((s) => !recentCommands.includes(s)).map((s) => (
                <button key={s} type="button" onClick={() => applyChipCommand(s)} style={chipStyle}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <input
            ref={customCommandInputRef}
            type="text"
            placeholder={t('agentManager.newAgent.commandPlaceholder')}
            value={customCommand}
            onChange={(e) => {
              setCustomCommand(e.target.value);
              setLaunchError(null);
            }}
            style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '11px' }}
          />
        </>
      )}

      {/* Prompt — always shown but optional for CLI agents */}
      <textarea
        placeholder={promptPlaceholder}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
          }
        }}
      />

      {/* Model picker — only for cloud agents */}
      {!isCliAgent && (
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          style={{
            ...inputStyle,
            cursor: 'pointer',
          }}
        >
          <optgroup label="Anthropic">
            <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
            <option value="claude-opus-4-6-20250515">Claude Opus 4.6</option>
          </optgroup>
          <optgroup label="OpenAI">
            <option value="gpt-4o">GPT-4o</option>
            <option value="o3">o3</option>
            <option value="o4-mini">o4-mini</option>
          </optgroup>
          <optgroup label="Local (Ollama)">
            <option value="llama3.3">Llama 3.3</option>
            <option value="qwen3">Qwen 3</option>
            <option value="deepseek-r1">DeepSeek R1</option>
          </optgroup>
        </select>
      )}

      {/* Context summary */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '10px',
          color: 'var(--xp-text-muted)',
          padding: '2px 0',
        }}
      >
        <span
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
        >
          {workingDirectory}
          {selectedFiles.length > 0 &&
            ` · ${selectedFiles.length} ${t('agentManager.scope.filesSelected')}`}
          {projectContext && ` · ${t('agentManager.scope.contextDetected')}`}
        </span>
        {!isCliAgent && (
          <button
            onClick={() => setShowScope((v) => !v)}
            style={{
              background: 'none',
              border: '1px solid var(--xp-border)',
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '10px',
              color: showScope ? 'var(--xp-blue)' : 'var(--xp-text-muted)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {t('agentManager.scope.configure')}
          </button>
        )}
      </div>

      {/* Scope config — expandable, cloud only */}
      {showScope && !isCliAgent && (
        <div
          style={{
            borderTop: '1px solid var(--xp-border)',
            paddingTop: '4px',
          }}
        >
          <AgentScopeConfig
            workingDirectory={workingDirectory}
            onDirectoryChange={handleDirectoryChange}
            scope={scope}
            onScopeChange={handleScopeChange}
            compact
          />
        </div>
      )}

      {/* Not-installed hint for known CLI agents */}
      {cliMissing && selectedCli && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '10px',
            color: 'var(--xp-text-muted)',
            background: 'var(--xp-bg)',
            border: '1px solid var(--xp-border)',
            borderRadius: '4px',
            padding: '4px 6px',
          }}
        >
          <span
            style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {t('agentManager.newAgent.cliMissingHint', { command: selectedCli.command })}
          </span>
          <button
            type="button"
            onClick={handleCopyInstall}
            style={{
              background: 'none',
              border: '1px solid var(--xp-border)',
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '10px',
              color: copiedInstall ? 'var(--xp-green)' : 'var(--xp-text-muted)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {copiedInstall
              ? t('agentManager.newAgent.copied')
              : t('agentManager.newAgent.copyInstall')}
          </button>
        </div>
      )}

      {/* Launch failure feedback */}
      {launchError && (
        <div
          style={{
            fontSize: '10px',
            color: 'var(--xp-red)',
            background: 'var(--xp-bg)',
            border: '1px solid var(--xp-border)',
            borderRadius: '4px',
            padding: '4px 6px',
            wordBreak: 'break-all',
          }}
          role="alert"
        >
          {launchError}
        </div>
      )}

      <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            padding: '4px 10px',
            fontSize: '11px',
            border: '1px solid var(--xp-border)',
            borderRadius: '4px',
            background: 'none',
            color: 'var(--xp-text-muted)',
            cursor: 'pointer',
          }}
        >
          {t('agentManager.newAgent.cancel')}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            padding: '4px 10px',
            fontSize: '11px',
            border: '1px solid var(--xp-green)',
            borderRadius: '4px',
            background: canSubmit ? 'var(--xp-green)' : 'var(--xp-surface-light)',
            color: canSubmit ? '#fff' : 'var(--xp-text-muted)',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            fontWeight: 600,
          }}
        >
          {isLaunching
            ? t('agentManager.newAgent.launching')
            : isCliAgent
              ? t('agentManager.newAgent.launch')
              : t('agentManager.newAgent.start')}
        </button>
      </div>
    </div>
  );
};

export default NewAgentForm;
