/**
 * Project Memory — CLI agent sessions recovered from ~/.claude/projects and
 * ~/.codex/sessions for the current folder. Zero instrumentation: the logs
 * are written by the agents themselves, wherever they ran.
 *
 * "Resume" relaunches the session in an embedded terminal via the CLI agent
 * launch chain (auto-creates the terminal tab).
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { History, RefreshCw } from 'lucide-react';
import { isTauri } from '@/lib/transport';
import { projectMemorySessions, type ProjectSession } from '@/lib/tauri-api/project-memory';
import { launchCustomCli } from './launch-cli-agent';
import { formatRelativeTime } from '../chat-history';

const agentLabel = (agent: ProjectSession['agent']): string =>
  agent === 'claude-code' ? 'Claude Code' : 'Codex';

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 6px',
  border: '1px solid var(--xp-border)',
  borderRadius: '4px',
  background: 'var(--xp-surface)',
  marginBottom: '4px',
};

interface ProjectMemorySectionProps {
  currentPath?: string;
}

const ProjectMemorySection = ({ currentPath }: ProjectMemorySectionProps) => {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cwd, setCwd] = useState('');

  const load = useCallback(async () => {
    const path = currentPath;
    if (!path) return;
    setCwd(path);
    setLoading(true);
    setError(null);
    try {
      const result = await projectMemorySessions(path);
      setSessions(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  useEffect(() => {
    if (isTauri()) void load();
  }, [load]);

  if (!isTauri()) return null;

  const handleResume = (session: ProjectSession) => {
    const command =
      session.agent === 'claude-code'
        ? `claude --resume ${session.id}`
        : `codex resume ${session.id}`;
    void launchCustomCli(cwd || '/', command).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <span
          style={{
            fontSize: '10px',
            color: 'var(--xp-text-muted)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={cwd}
        >
          {loading
            ? t('agentManager.projectMemory.loading')
            : cwd || t('agentManager.projectMemory.noFolder')}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          title={t('agentManager.projectMemory.refresh')}
          style={{
            background: 'none',
            border: '1px solid var(--xp-border)',
            borderRadius: '4px',
            padding: '1px 4px',
            cursor: 'pointer',
            color: 'var(--xp-text-muted)',
            display: 'inline-flex',
          }}
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div style={{ fontSize: '10px', color: 'var(--xp-red)', padding: '2px 0' }}>
          {t('agentManager.projectMemory.loadError')}: {error}
        </div>
      )}

      {!error && !loading && sessions.length === 0 && (
        <div style={{ fontSize: '10px', color: 'var(--xp-text-muted)', padding: '4px 2px' }}>
          <History size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
          {t('agentManager.projectMemory.empty')}
        </div>
      )}

      {sessions.map((session) => (
        <div key={`${session.agent}-${session.id}`} style={rowStyle}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: '11px',
                color: 'var(--xp-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={session.title}
            >
              {session.title}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--xp-text-muted)' }}>
              {agentLabel(session.agent)} ·{' '}
              {session.lastActivity
                ? formatRelativeTime(Date.parse(session.lastActivity) || Date.now())
                : ''}
              {session.changedFiles.length > 0 &&
                ` · ${t('agentManager.projectMemory.changedFiles', {
                  count: session.changedFiles.length,
                })}`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleResume(session)}
            style={{
              background: 'none',
              border: '1px solid var(--xp-border)',
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '10px',
              color: 'var(--xp-text-muted)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
            title={t('agentManager.projectMemory.resumeHint')}
          >
            {t('agentManager.projectMemory.resume')}
          </button>
        </div>
      ))}
    </div>
  );
};

export default ProjectMemorySection;
