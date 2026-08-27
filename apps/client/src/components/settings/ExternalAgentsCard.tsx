/**
 * "External Agents" card for Settings → AI — the recommended zero-config
 * lane (Plan B): Claude Code & friends run in the embedded terminal with
 * their own subscriptions; Wisp only needs to know whether they are
 * installed. Dumb component — statuses and labels arrive via props.
 */
import type { CSSProperties } from 'react';

export interface ExternalAgentStatus {
  /** binary name, e.g. "claude" */
  command: string;
  /** display name, e.g. "Claude Code" */
  label: string;
  /** undefined = detection unavailable (web demo); true/false = detected */
  installed?: boolean;
  /** copy-to-clipboard install command when not installed */
  installCmd?: string;
}

export interface ExternalAgentsCardProps {
  title: string;
  description: string;
  agents: ExternalAgentStatus[];
  copiedLabel: string;
  copyLabel: string;
  onCopy?: (installCmd: string) => void;
  copiedCommand?: string | null;
}

const cardStyle: CSSProperties = {
  border: '1px solid var(--xp-border)',
  borderRadius: '8px',
  padding: '12px',
  marginBottom: '12px',
  background: 'var(--xp-surface)',
};

const dotColor = (installed?: boolean): string => {
  if (installed === undefined) return 'var(--xp-text-muted)';
  return installed ? 'var(--xp-green)' : 'var(--xp-red)';
};

const dot = (installed?: boolean): CSSProperties => ({
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: '50%',
  marginRight: 6,
  background: dotColor(installed),
});

const ExternalAgentsCard = ({
  title,
  description,
  agents,
  copiedLabel,
  copyLabel,
  onCopy,
  copiedCommand,
}: ExternalAgentsCardProps) => (
  <div style={cardStyle} data-testid="external-agents-card">
    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--xp-text)' }}>{title}</div>
    <div style={{ fontSize: '12px', color: 'var(--xp-text-secondary)', margin: '4px 0 10px' }}>
      {description}
    </div>
    {agents.map((agent) => (
      <div
        key={agent.command}
        data-testid={`external-agent-${agent.command}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 0',
          borderTop: '1px solid var(--xp-border)',
        }}
      >
        <span style={dot(agent.installed)} aria-hidden="true" />
        <span style={{ fontSize: '13px', color: 'var(--xp-text)', flex: 1 }}>{agent.label}</span>
        {agent.installed === false && agent.installCmd && (
          <button
            type="button"
            onClick={() => agent.installCmd && onCopy?.(agent.installCmd)}
            style={{
              background: 'none',
              border: '1px solid var(--xp-border)',
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '11px',
              color: 'var(--xp-text-muted)',
              cursor: 'pointer',
            }}
          >
            {copiedCommand === agent.installCmd ? copiedLabel : copyLabel}
          </button>
        )}
      </div>
    ))}
  </div>
);

export default ExternalAgentsCard;
