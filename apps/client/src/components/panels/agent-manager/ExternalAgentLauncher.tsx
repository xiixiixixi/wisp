import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Folder, Play, RefreshCw, Terminal } from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';
import { isTauri } from '@/lib/transport';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import {
  launchClaudeCode,
  launchCodex,
  launchCustomCli,
  launchGeminiCli,
  launchOpenCode,
  type CliAgentResult,
} from './launch-cli-agent';
import { AGENT_LAUNCH_REQUEST_EVENT, consumePendingAgentPrompt } from './agent-launch-request';

type ExternalAgentType = 'claude-code' | 'codex' | 'opencode' | 'gemini-cli' | 'custom-cli';

interface ExternalAgentDefinition {
  type: Exclude<ExternalAgentType, 'custom-cli'>;
  command: string;
  installCommand: string;
  label: string;
}

const EXTERNAL_AGENTS: ExternalAgentDefinition[] = [
  {
    type: 'claude-code',
    command: 'claude',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    label: 'Claude Code',
  },
  {
    type: 'codex',
    command: 'codex',
    installCommand: 'npm install -g @openai/codex',
    label: 'Codex',
  },
  {
    type: 'opencode',
    command: 'opencode',
    installCommand: 'curl -fsSL https://opencode.ai/install | bash',
    label: 'OpenCode',
  },
  {
    type: 'gemini-cli',
    command: 'gemini',
    installCommand: 'npm install -g @google/gemini-cli',
    label: 'Gemini CLI',
  },
];

const isExternalAgentType = (value: string | null): value is ExternalAgentType =>
  value === 'claude-code' ||
  value === 'codex' ||
  value === 'opencode' ||
  value === 'gemini-cli' ||
  value === 'custom-cli';

const statusDotClass = (detected?: boolean): string => {
  if (detected === true) return 'bg-xp-green';
  if (detected === false) return 'bg-xp-text-muted';
  return 'border border-xp-text-muted';
};

interface ExternalAgentLauncherProps {
  currentPath: string;
  onLaunched?: (sessionId: string, label: string) => void;
}

const ExternalAgentLauncher = ({ currentPath, onLaunched }: ExternalAgentLauncherProps) => {
  const { t } = useTranslation();
  const [agentType, setAgentType] = useState<ExternalAgentType>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.AGENT_LAUNCHER_LAST_TYPE);
    return isExternalAgentType(saved) ? saved : 'claude-code';
  });
  const [prompt, setPrompt] = useState('');
  const [customCommand, setCustomCommand] = useState(
    () => localStorage.getItem(STORAGE_KEYS.AGENT_LAUNCHER_CUSTOM_COMMAND) || '',
  );
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [detecting, setDetecting] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const detectInstalledAgents = useCallback(async () => {
    if (!isTauri()) return;
    setDetecting(true);
    try {
      setInstalled(await TauriAPI.checkCliInstalled(EXTERNAL_AGENTS.map((agent) => agent.command)));
    } catch {
      // Detection is a hint only; aliases and custom paths may still work.
    } finally {
      setDetecting(false);
    }
  }, []);

  useEffect(() => {
    void detectInstalledAgents();
  }, [detectInstalledAgents]);

  useEffect(() => {
    const applyPendingPrompt = (event?: Event) => {
      const eventPrompt = (event as CustomEvent<{ prompt?: string }> | undefined)?.detail?.prompt;
      const nextPrompt = eventPrompt || consumePendingAgentPrompt();
      if (nextPrompt) setPrompt(nextPrompt);
    };

    applyPendingPrompt();
    window.addEventListener(AGENT_LAUNCH_REQUEST_EVENT, applyPendingPrompt);
    return () => window.removeEventListener(AGENT_LAUNCH_REQUEST_EVENT, applyPendingPrompt);
  }, []);

  const selectedDefinition = useMemo(
    () => EXTERNAL_AGENTS.find((agent) => agent.type === agentType) ?? null,
    [agentType],
  );

  const selectedMissing =
    !!selectedDefinition &&
    isTauri() &&
    selectedDefinition.command in installed &&
    !installed[selectedDefinition.command];
  const detectedCount = EXTERNAL_AGENTS.filter((agent) => installed[agent.command]).length;
  const detectionComplete = EXTERNAL_AGENTS.some((agent) => agent.command in installed);

  const canLaunch =
    !launching &&
    currentPath.length > 0 &&
    (agentType !== 'custom-cli' || customCommand.trim().length > 0);

  const handleLaunch = async () => {
    if (!canLaunch) return;
    setLaunching(true);
    setError(null);

    try {
      const initialPrompt = prompt.trim() || undefined;
      let result: CliAgentResult;
      switch (agentType) {
        case 'claude-code':
          result = await launchClaudeCode(currentPath, initialPrompt);
          break;
        case 'codex':
          result = await launchCodex(currentPath, initialPrompt);
          break;
        case 'opencode':
          result = await launchOpenCode(currentPath);
          break;
        case 'gemini-cli':
          result = await launchGeminiCli(currentPath, initialPrompt);
          break;
        case 'custom-cli':
          result = await launchCustomCli(currentPath, customCommand.trim(), initialPrompt);
          break;
      }

      localStorage.setItem(STORAGE_KEYS.AGENT_LAUNCHER_LAST_TYPE, agentType);
      if (agentType === 'custom-cli') {
        localStorage.setItem(STORAGE_KEYS.AGENT_LAUNCHER_CUSTOM_COMMAND, customCommand.trim());
      }
      setPrompt('');
      onLaunched?.(result.sessionId, result.label);
    } catch (launchError) {
      setError(
        `${t('agentManager.newAgent.launchFailed')}: ${
          launchError instanceof Error ? launchError.message : String(launchError)
        }`,
      );
    } finally {
      setLaunching(false);
    }
  };

  const copyInstallCommand = () => {
    if (!selectedDefinition) return;
    navigator.clipboard.writeText(selectedDefinition.installCommand).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="external-agent-launcher">
      <div className="flex items-center gap-2 rounded-md border border-xp-border bg-xp-bg px-2.5 py-2">
        <Folder size={13} className="shrink-0 text-xp-text-muted" aria-hidden="true" />
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-xp-text-secondary"
          title={currentPath}
        >
          {currentPath}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2 text-[11px] text-xp-text-muted">
          <span>{t('agentManager.cockpit.toolTitle')}</span>
          <div className="flex items-center gap-1.5">
            <span>
              {detectionComplete
                ? t('agentManager.cockpit.detectedCount', {
                    detected: detectedCount,
                    total: EXTERNAL_AGENTS.length,
                  })
                : t('agentManager.cockpit.detectionUnavailable')}
            </span>
            <button
              type="button"
              onClick={() => void detectInstalledAgents()}
              disabled={!isTauri() || detecting}
              aria-label={t('agentManager.cockpit.refreshDetection')}
              title={t('agentManager.cockpit.refreshDetection')}
              className="rounded p-1 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text disabled:opacity-40"
            >
              <RefreshCw size={11} className={detecting ? 'animate-spin' : ''} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div
          className="overflow-hidden rounded-md border border-xp-border bg-xp-bg"
          role="radiogroup"
          aria-label={t('agentManager.cockpit.agentLabel')}
        >
          {EXTERNAL_AGENTS.map((agent, index) => {
            const selected = agentType === agent.type;
            const detected = installed[agent.command];
            let status = t('agentManager.cockpit.statusUnknown');
            if (detected === true) status = t('agentManager.cockpit.statusInstalled');
            if (detected === false) status = t('agentManager.cockpit.statusMissing');

            return (
              <button
                key={agent.type}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setAgentType(agent.type);
                  setError(null);
                }}
                className={`flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary ${
                  index > 0 ? 'border-t border-xp-border' : ''
                } ${selected ? 'bg-xp-surface-light' : 'hover:bg-xp-surface/70'}`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDotClass(detected)}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-xp-text">
                  {agent.label}
                </span>
                <span className="text-[10px] text-xp-text-muted">{status}</span>
                {selected && (
                  <Check size={12} className="shrink-0 text-xp-blue" aria-hidden="true" />
                )}
              </button>
            );
          })}

          <button
            type="button"
            role="radio"
            aria-checked={agentType === 'custom-cli'}
            onClick={() => {
              setAgentType('custom-cli');
              setError(null);
            }}
            className={`flex w-full items-center gap-2.5 border-t border-xp-border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary ${
              agentType === 'custom-cli' ? 'bg-xp-surface-light' : 'hover:bg-xp-surface/70'
            }`}
          >
            <Terminal size={12} className="shrink-0 text-xp-text-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-xp-text">
              {t('agentManager.newAgent.typeCustomCli')}
            </span>
            <span className="text-[10px] text-xp-text-muted">
              {t('agentManager.cockpit.statusCustom')}
            </span>
            {agentType === 'custom-cli' && (
              <Check size={12} className="shrink-0 text-xp-blue" aria-hidden="true" />
            )}
          </button>
        </div>

        <div className="flex items-start gap-2 px-0.5 pt-1 text-[10px] leading-4 text-xp-text-muted">
          <Terminal size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('agentManager.cockpit.externalOwnership')}</span>
        </div>
      </div>

      {agentType === 'custom-cli' && (
        <label className="flex flex-col gap-1.5 text-[11px] text-xp-text-muted">
          <span>{t('agentManager.cockpit.commandLabel')}</span>
          <input
            aria-label={t('agentManager.cockpit.commandLabel')}
            value={customCommand}
            onChange={(event) => {
              setCustomCommand(event.target.value);
              localStorage.setItem(STORAGE_KEYS.AGENT_LAUNCHER_CUSTOM_COMMAND, event.target.value);
            }}
            placeholder={t('agentManager.newAgent.commandPlaceholder')}
            className="h-9 rounded-md border border-xp-border bg-xp-bg px-2.5 font-mono text-xs text-xp-text outline-none transition-colors placeholder:text-xp-text-muted focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </label>
      )}

      <label className="flex flex-col gap-1.5 text-[11px] text-xp-text-muted">
        <span>{t('agentManager.cockpit.promptLabel')}</span>
        <textarea
          aria-label={t('agentManager.cockpit.promptLabel')}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void handleLaunch();
            }
          }}
          rows={4}
          placeholder={t('agentManager.cockpit.promptPlaceholder')}
          className="min-h-24 resize-y rounded-md border border-xp-border bg-xp-bg px-2.5 py-2 text-xs leading-5 text-xp-text outline-none transition-colors placeholder:text-xp-text-muted focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </label>

      {selectedMissing && selectedDefinition && (
        <div className="flex items-center gap-2 rounded-md border border-xp-border bg-xp-bg px-2.5 py-2 text-[11px] text-xp-text-muted">
          <span className="min-w-0 flex-1">
            {t('agentManager.newAgent.cliMissingHint', { command: selectedDefinition.command })}
          </span>
          <button
            type="button"
            onClick={copyInstallCommand}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-xp-border px-2 py-1 text-xp-text-secondary transition-colors hover:bg-xp-surface-light hover:text-xp-text"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? t('agentManager.newAgent.copied') : t('agentManager.newAgent.copyInstall')}
          </button>
        </div>
      )}

      {error && (
        <div
          className="border-xp-error/40 bg-xp-error/5 text-xp-error rounded-md border px-2.5 py-2 text-[11px]"
          role="alert"
        >
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleLaunch()}
        disabled={!canLaunch}
        className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-xp-blue px-3 text-xs font-semibold text-white transition-colors hover:bg-xp-blue-dark focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Play size={13} fill="currentColor" aria-hidden="true" />
        {launching ? t('agentManager.newAgent.launching') : t('agentManager.newAgent.launch')}
      </button>
    </div>
  );
};

export default ExternalAgentLauncher;
