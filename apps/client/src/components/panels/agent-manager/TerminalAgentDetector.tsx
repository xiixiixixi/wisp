import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Folder, Terminal, X } from 'lucide-react';
import { TauriAPI } from '@/lib/tauri-api';
import type { PtyOutputPayload } from '@/lib/tauri-api/pty';
import {
  dismissExternalAgent,
  getExternalAgent,
  getExternalAgentsSnapshot,
  markExternalAgentExited,
  subscribeToExternalAgents,
  updateExternalAgent,
  upsertExternalAgent,
  type ExternalAgent,
  type ExternalAgentType,
} from './external-agent-registry';

export type {
  ExternalAgent,
  ExternalAgentStatus,
  ExternalAgentType,
} from './external-agent-registry';

const DETECTION_PATTERNS: Array<[ExternalAgentType, RegExp[]]> = [
  [
    'claude-code',
    [/Claude Code v[\d.]/i, /claude>/, /claude-(?:opus|sonnet)/i, /\bclaude\s+code\b/i],
  ],
  ['codex', [/Codex CLI/i, /codex>/, /\bcodex\b.*v[\d.]/i, /openai\/codex/i]],
  ['gemini', [/Gemini CLI/i, /gemini>/, /\bgemini-cli\b/i]],
  ['opencode', [/█▀▀█ █▀▀█/, /opencode\s+tui/i, /opencode\s+v?\d+(\.\d+)+/i]],
  ['aider', [/\baider\b.*v[\d.]/i, /aider>/i, /Aider chat/i]],
];

const DISPLAY_NAMES: Record<ExternalAgentType, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  aider: 'Aider',
  unknown: 'Agent',
};

const FILE_PATH_RE =
  /(?:(?:reading|writing|editing|created|modified|deleted)\s+)?(?:file\s+)?['"`]?((?:\/|[A-Z]:\\)[\w/.\\-]+\.\w+)['"`]?/gi;
const IDLE_TIMEOUT_MS = 30_000;

const detectAgentType = (text: string): ExternalAgentType | null => {
  for (const [type, patterns] of DETECTION_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(text))) return type;
  }
  return null;
};

const extractFilePaths = (text: string): string[] => {
  const paths: string[] = [];
  FILE_PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_PATH_RE.exec(text)) !== null) {
    if (match[1]) paths.push(match[1]);
  }
  return paths;
};

const TerminalAgentDetector = () => {
  const { t } = useTranslation();
  const agents = useSyncExternalStore(
    subscribeToExternalAgents,
    getExternalAgentsSnapshot,
    getExternalAgentsSnapshot,
  );
  const idleTimers = useRef<Map<string, number>>(new Map());

  const scheduleIdle = useCallback((sessionId: string) => {
    const existingTimer = idleTimers.current.get(sessionId);
    if (existingTimer) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      const agent = getExternalAgent(sessionId);
      if (agent?.status === 'active') {
        updateExternalAgent(sessionId, { status: 'idle' });
      }
    }, IDLE_TIMEOUT_MS);
    idleTimers.current.set(sessionId, timer);
  }, []);

  const handlePtyOutput = useCallback(
    (payload: PtyOutputPayload) => {
      // eslint-disable-next-line no-control-regex
      const cleanData = payload.data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
      const existing = getExternalAgent(payload.session_id);
      const mentionedFiles = extractFilePaths(cleanData);

      if (existing) {
        updateExternalAgent(payload.session_id, {
          status: 'active',
          lastActivityAt: Date.now(),
          filesChanged: Array.from(new Set([...existing.filesChanged, ...mentionedFiles])).slice(
            -100,
          ),
        });
        scheduleIdle(payload.session_id);
        return;
      }

      // Agents started manually in a regular Wisp terminal remain discoverable.
      const type = detectAgentType(cleanData);
      if (!type) return;
      const now = Date.now();
      upsertExternalAgent({
        id: `ext-${payload.session_id}`,
        type,
        displayName: DISPLAY_NAMES[type],
        terminalSessionId: payload.session_id,
        terminalLabel: `Terminal (${payload.session_id.slice(-6)})`,
        workingDirectory: '',
        status: 'active',
        detectedAt: now,
        lastActivityAt: now,
        filesChanged: mentionedFiles,
      });
      scheduleIdle(payload.session_id);
    },
    [scheduleIdle],
  );

  useEffect(() => {
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    void TauriAPI.listenToPtyOutput(handlePtyOutput).then((unlisten) => {
      unlistenOutput = unlisten;
    });
    void TauriAPI.listenToPtyExit((sessionId) => {
      markExternalAgentExited(sessionId);
      const timer = idleTimers.current.get(sessionId);
      if (timer) window.clearTimeout(timer);
      idleTimers.current.delete(sessionId);
    }).then((unlisten) => {
      unlistenExit = unlisten;
    });

    const timers = idleTimers.current;
    return () => {
      unlistenOutput?.();
      unlistenExit?.();
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, [handlePtyOutput]);

  const visibleAgents = agents.filter((agent) => agent.status !== 'exited');
  if (visibleAgents.length === 0) {
    return (
      <div className="rounded-[2px] border border-dashed border-xp-border px-3 py-4 text-center text-[11px] leading-5 text-xp-text-muted">
        {t('agentManager.cockpit.noRunning')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {visibleAgents.map((agent: ExternalAgent) => {
        const active = agent.status === 'active';
        return (
          <div
            key={agent.terminalSessionId}
            className="rounded-[2px] border border-xp-border bg-xp-bg px-2.5 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-xp-green' : 'bg-xp-yellow'}`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-xp-text">
                {agent.displayName}
              </span>
              <span className="text-[10px] text-xp-text-muted">
                {t(`agentManager.externalAgents.status.${agent.status}`)}
              </span>
              <button
                type="button"
                onClick={() => dismissExternalAgent(agent.terminalSessionId)}
                className="rounded-[2px] p-0.5 text-xp-text-muted transition-colors hover:bg-xp-surface-light hover:text-xp-text"
                aria-label={t('agentManager.externalAgents.dismiss')}
                title={t('agentManager.externalAgents.dismiss')}
              >
                <X size={11} />
              </button>
            </div>

            <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-xp-text-muted">
              <Terminal size={10} aria-hidden="true" />
              <span className="truncate">{agent.terminalLabel}</span>
            </div>

            {agent.workingDirectory && (
              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-xp-text-muted">
                <Folder size={10} className="shrink-0" aria-hidden="true" />
                <span className="truncate font-mono" title={agent.workingDirectory}>
                  {agent.workingDirectory}
                </span>
              </div>
            )}

            {agent.filesChanged.length > 0 && (
              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-xp-text-muted">
                <FileText size={10} aria-hidden="true" />
                <span>
                  {t('agentManager.externalAgents.filesChanged', {
                    count: agent.filesChanged.length,
                  })}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default TerminalAgentDetector;
